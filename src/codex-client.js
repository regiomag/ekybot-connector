/**
 * Codex Client
 *
 * Routes messages from EkyBot dashboard to the local OpenAI Codex CLI.
 * This module executes Codex as a subprocess on the user's machine.
 *
 * Network calls: NONE (local subprocess only).
 * External dependency: `codex` CLI must be installed and authenticated.
 *
 * Billing model: OpenAI API tokens.
 */

const { spawn } = require('child_process');
const chalk = require('chalk');
const os = require('os');
const path = require('path');
const fs = require('fs');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_OUTPUT_LENGTH = 50_000; // ~50KB max response

/** Expand ~ to home directory (spawn/fs don't do shell expansion) */
function expandTilde(dir) {
  if (!dir) return dir;
  return dir.startsWith('~') ? path.join(os.homedir(), dir.slice(1)) : dir;
}

function resolveWorkingDir() {
  const raw = process.env.EKYBOT_CODEX_WORKING_DIR || process.env.HOME || '/tmp';
  return expandTilde(raw);
}

function resolveTimeoutMs() {
  const raw = process.env.EKYBOT_CODEX_TIMEOUT_MS;
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function resolveMaxOutput() {
  const raw = process.env.EKYBOT_CODEX_MAX_OUTPUT;
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MAX_OUTPUT_LENGTH;
}

function isEnabled() {
  return process.env.EKYBOT_CODEX_ENABLED !== 'false';
}

/**
 * Execute a one-shot Codex prompt and return the response.
 *
 * @param {string} message - The user's message from EkyBot
 * @param {object} options
 * @param {string} options.workingDir - Working directory for Codex
 * @param {number} options.timeoutMs - Timeout in milliseconds
 * @returns {Promise<{content: string, model: string, billingType: string, exitCode: number}>}
 */
async function executeCodex(message, options = {}) {
  const {
    workingDir = resolveWorkingDir(),
    timeoutMs = resolveTimeoutMs(),
  } = options;

  const maxOutput = resolveMaxOutput();

  if (!isEnabled()) {
    throw new Error('codex is disabled via environment config');
  }

  // Resolve ~ and ensure directory exists
  const resolvedDir = expandTilde(workingDir);
  fs.mkdirSync(resolvedDir, { recursive: true });

  console.log(
    chalk.magenta(
      `[codex] executing prompt in ${resolvedDir} (timeout=${Math.round(timeoutMs / 1000)}s)`
    )
  );

  return new Promise((resolve, reject) => {
    // codex exec: non-interactive mode
    // --full-auto: no approval prompts + workspace-write sandbox
    // -C: working directory
    const args = [
      'exec',
      '--full-auto',
      '-C', resolvedDir,
      message,
    ];

    // Enrich PATH for macOS LaunchAgent
    const enrichedEnv = { ...process.env };
    const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', `${process.env.HOME}/.nvm/versions/node/current/bin`];
    const currentPath = enrichedEnv.PATH || '/usr/bin:/bin';
    enrichedEnv.PATH = [...extraPaths, ...currentPath.split(':')].filter(Boolean).join(':');

    const proc = spawn('codex', args, {
      cwd: resolvedDir,
      env: enrichedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let truncated = false;

    const settle = (fn) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      if (stdout.length > maxOutput && !truncated) {
        truncated = true;
        proc.kill('SIGTERM');
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (truncated) {
        stdout = stdout.substring(0, maxOutput) + '\n\n[Output truncated]';
      }

      settle(() => {
        // Codex exec outputs metadata lines then the actual response at the end.
        // Extract just the final agent response.
        const response = extractCodexResponse(stdout) || stdout.trim() || '[No output]';

        if (code === 0 || response.length > 0) {
          console.log(
            chalk.magenta(
              `[codex] completed exitCode=${code} responseChars=${response.length}`
            )
          );
          resolve({
            content: response,
            model: 'openai/codex',
            billingType: 'api',
            exitCode: code,
          });
        } else {
          const errMsg = stderr.trim() || `Codex exited with code ${code}`;

          if (
            stderr.includes('rate limit') ||
            stderr.includes('429') ||
            stderr.includes('too many')
          ) {
            console.warn(chalk.yellow(`[codex] rate limit hit`));
            resolve({
              content: '⏳ Rate limit atteint sur ton plan OpenAI. Réessaie dans quelques minutes.',
              model: 'openai/codex',
              billingType: 'api',
              exitCode: code,
            });
            return;
          }

          reject(new Error(errMsg));
        }
      });
    });

    proc.on('error', (err) => {
      settle(() => {
        if (err.code === 'ENOENT') {
          const cwdExists = fs.existsSync(resolvedDir);
          if (!cwdExists) {
            reject(new Error(`Working directory does not exist: ${resolvedDir}`));
          } else {
            reject(new Error('Codex CLI not found. Install: npm install -g @openai/codex'));
          }
        } else {
          reject(err);
        }
      });
    });

    // Hard timeout
    const timer = setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
      settle(() => {
        if (stdout.trim().length > 0) {
          const response = extractCodexResponse(stdout) || stdout.trim();
          resolve({
            content: response.substring(0, maxOutput) +
              `\n\n[Timed out after ${Math.round(timeoutMs / 1000)}s]`,
            model: 'openai/codex',
            billingType: 'api',
            exitCode: -1,
          });
        } else {
          reject(
            new Error(`Codex timed out after ${Math.round(timeoutMs / 1000)}s`)
          );
        }
      });
    }, timeoutMs);

    proc.on('close', () => clearTimeout(timer));
  });
}

/**
 * Extract the final agent response from codex exec output.
 * Codex exec prints metadata (workdir, model, etc.) then the conversation.
 * The last block after "codex\n" is the actual response.
 */
function extractCodexResponse(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Look for the last "codex" speaker block
  const lines = trimmed.split('\n');
  let lastCodexIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === 'codex') {
      lastCodexIdx = i;
      break;
    }
  }

  if (lastCodexIdx >= 0 && lastCodexIdx < lines.length - 1) {
    // Everything after "codex" line until "tokens used" or end
    const responseLines = [];
    for (let i = lastCodexIdx + 1; i < lines.length; i++) {
      if (lines[i].trim() === 'tokens used') break;
      responseLines.push(lines[i]);
    }
    const response = responseLines.join('\n').trim();
    if (response) return response;
  }

  return trimmed;
}

/**
 * Check if Codex CLI is installed.
 * @returns {Promise<{available: boolean, version: string|null, error: string|null}>}
 */
async function healthCheck() {
  return new Promise((resolve) => {
    const enrichedEnv = { ...process.env };
    const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', `${process.env.HOME}/.nvm/versions/node/current/bin`];
    const currentPath = enrichedEnv.PATH || '/usr/bin:/bin';
    enrichedEnv.PATH = [...extraPaths, ...currentPath.split(':')].filter(Boolean).join(':');

    const proc = spawn('codex', ['--version'], {
      timeout: 10_000,
      env: enrichedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green(`[codex] health OK: ${stdout.trim()}`));
        resolve({ available: true, version: stdout.trim(), error: null });
      } else {
        resolve({ available: false, version: null, error: 'Codex CLI not available' });
      }
    });
    proc.on('error', () => {
      resolve({ available: false, version: null, error: 'Codex CLI not installed' });
    });
  });
}

/**
 * Returns true if the given provider string indicates a Codex agent.
 * @param {string|null|undefined} provider
 * @returns {boolean}
 */
function isCodexProvider(provider) {
  return provider === 'codex' || provider === 'codex-cli';
}

module.exports = { executeCodex, healthCheck, isCodexProvider };
