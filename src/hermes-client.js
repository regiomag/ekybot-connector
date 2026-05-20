/**
 * Hermes Agent Client
 *
 * Routes messages from EkyBot dashboard to the local Hermes CLI.
 * This module executes `hermes chat -q "..." --quiet` as a subprocess.
 *
 * Network calls: NONE (local subprocess only — Hermes calls OpenRouter internally).
 * External dependency: `hermes` CLI must be installed (~/.local/bin/hermes).
 *
 * Billing model: OpenRouter API — cost tracked by OpenRouter, not EkyBot.
 */

const { spawn } = require('child_process');
const chalk = require('chalk');
const os = require('os');
const path = require('path');
const fs = require('fs');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_OUTPUT_LENGTH = 50_000; // ~50KB max response
const HERMES_PROJECT_DIR = path.join(os.homedir(), '.openclaw', 'hermes-agent');
const HERMES_BIN = path.join(os.homedir(), '.local', 'bin', 'hermes');
const HERMES_DEFAULT_HOME = path.join(os.homedir(), '.hermes');

/**
 * Resolve HERMES_HOME for a given profile name.
 * 'default' or null → ~/.hermes
 * other → ~/.hermes/profiles/<name>
 */
function resolveHermesHome(profile) {
  if (!profile || profile === 'default') {
    return HERMES_DEFAULT_HOME;
  }
  return path.join(HERMES_DEFAULT_HOME, 'profiles', profile);
}

function resolveTimeoutMs() {
  const raw = process.env.EKYBOT_HERMES_TIMEOUT_MS;
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function resolveMaxOutput() {
  const raw = process.env.EKYBOT_HERMES_MAX_OUTPUT;
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MAX_OUTPUT_LENGTH;
}

/**
 * Execute a one-shot Hermes prompt and return the response.
 *
 * @param {string} message - The user's message from EkyBot
 * @param {object} options
 * @param {number} options.timeoutMs - Timeout in milliseconds
 * @param {string} options.systemPrompt - Optional system prompt
 * @param {string} options.profile - Hermes profile name (default, cortex, etc.)
 * @returns {Promise<{content: string, model: string, billingType: string, exitCode: number}>}
 */
async function executeHermes(message, options = {}) {
  const {
    timeoutMs = resolveTimeoutMs(),
    systemPrompt = null,
    profile = null,
  } = options;

  const maxOutput = resolveMaxOutput();

  const hermesHome = resolveHermesHome(profile);
  const profileLabel = profile || 'default';

  console.log(
    chalk.magenta(
      `[hermes] executing prompt (profile=${profileLabel} timeout=${Math.round(timeoutMs / 1000)}s)`
    )
  );

  return new Promise((resolve, reject) => {
    // Build command: hermes chat -q "message" --quiet
    const args = ['chat', '-q', message, '--quiet'];

    // Enrich PATH for macOS LaunchAgent
    const enrichedEnv = { ...process.env };
    const extraPaths = [
      path.join(os.homedir(), '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ];
    const currentPath = enrichedEnv.PATH || '/usr/bin:/bin';
    enrichedEnv.PATH = [...extraPaths, ...currentPath.split(':')].filter(Boolean).join(':');

    // Hermes needs its venv — activate by pointing to the right Python
    const venvBin = path.join(HERMES_PROJECT_DIR, 'venv', 'bin');
    enrichedEnv.PATH = [venvBin, ...enrichedEnv.PATH.split(':')].filter(Boolean).join(':');
    enrichedEnv.VIRTUAL_ENV = path.join(HERMES_PROJECT_DIR, 'venv');

    // Set HERMES_HOME to use the correct profile
    enrichedEnv.HERMES_HOME = hermesHome;

    const proc = spawn(HERMES_BIN, args, {
      cwd: HERMES_PROJECT_DIR,
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
        if (code === 0 || stdout.trim().length > 0) {
          const response = stdout.trim() || '[No output]';
          // Estimate tokens for cost monitoring (~3.7 chars per token)
          const promptTokensEst = Math.round(message.length / 3.7);
          const responseTokensEst = Math.round(response.length / 3.7);
          const overheadTokensEst = 14000; // fixed Hermes overhead (system + tools)
          const totalTokensEst = promptTokensEst + responseTokensEst + overheadTokensEst;
          console.log(
            chalk.magenta(
              `[hermes] completed exitCode=${code} responseChars=${response.length} ` +
              `tokens≈${totalTokensEst} (prompt≈${promptTokensEst} response≈${responseTokensEst} overhead≈${overheadTokensEst})`
            )
          );
          resolve({
            content: response,
            model: 'hermes/openrouter',
            billingType: 'api',
            exitCode: code,
          });
        } else {
          const errMsg = stderr.trim() || `Hermes exited with code ${code}`;

          if (
            stderr.includes('rate limit') ||
            stderr.includes('429') ||
            stderr.includes('too many')
          ) {
            console.warn(chalk.yellow(`[hermes] rate limit hit`));
            resolve({
              content:
                '⏳ Rate limit atteint sur OpenRouter. Réessaie dans quelques minutes.',
              model: 'hermes/openrouter',
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
          reject(new Error(`Hermes CLI not found at ${HERMES_BIN}. Run setup-hermes.sh first.`));
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
          resolve({
            content:
              stdout.trim().substring(0, maxOutput) +
              `\n\n[Timed out after ${Math.round(timeoutMs / 1000)}s]`,
            model: 'hermes/openrouter',
            billingType: 'api',
            exitCode: -1,
          });
        } else {
          reject(
            new Error(
              `Hermes timed out after ${Math.round(timeoutMs / 1000)}s`
            )
          );
        }
      });
    }, timeoutMs);

    proc.on('close', () => clearTimeout(timer));
  });
}

/**
 * Check if Hermes CLI is installed.
 * @returns {Promise<{available: boolean, version: string|null, error: string|null}>}
 */
async function healthCheck() {
  return new Promise((resolve) => {
    if (!fs.existsSync(HERMES_BIN)) {
      resolve({ available: false, version: null, error: 'Hermes CLI not installed' });
      return;
    }

    const enrichedEnv = { ...process.env };
    const venvBin = path.join(HERMES_PROJECT_DIR, 'venv', 'bin');
    enrichedEnv.PATH = [venvBin, path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', enrichedEnv.PATH].filter(Boolean).join(':');
    enrichedEnv.VIRTUAL_ENV = path.join(HERMES_PROJECT_DIR, 'venv');

    const proc = spawn(HERMES_BIN, ['--version'], {
      timeout: 10_000,
      cwd: HERMES_PROJECT_DIR,
      env: enrichedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green(`[hermes] health OK: ${stdout.trim()}`));
        resolve({ available: true, version: stdout.trim(), error: null });
      } else {
        resolve({ available: false, version: null, error: 'Hermes CLI not available' });
      }
    });
    proc.on('error', () => {
      resolve({ available: false, version: null, error: 'Hermes CLI not installed' });
    });
  });
}

/**
 * Returns true if the given provider string indicates a Hermes agent.
 * @param {string|null|undefined} provider
 * @returns {boolean}
 */
function isHermesProvider(provider) {
  return provider === 'hermes' || provider === 'hermes-cli';
}

module.exports = { executeHermes, healthCheck, isHermesProvider };
