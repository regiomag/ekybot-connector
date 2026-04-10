/**
 * Claude Code Client
 *
 * Routes messages from EkyBot dashboard to the local Claude Code CLI.
 * This module executes Claude Code as a subprocess on the user's machine.
 *
 * Network calls: NONE (local subprocess only).
 * External dependency: `claude` CLI must be installed and authenticated.
 *
 * Billing model: Claude Pro/Max subscription — NOT API tokens.
 * No cost tracking, no budget guards for this transport.
 */

const { spawn } = require('child_process');
const chalk = require('chalk');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_OUTPUT_LENGTH = 50_000; // ~50KB max response

function resolveWorkingDir(agentType) {
  if (agentType === 'claude-cowork') {
    return (
      process.env.EKYBOT_CLAUDE_COWORK_WORKING_DIR ||
      process.env.HOME ||
      '/tmp'
    );
  }
  return (
    process.env.EKYBOT_CLAUDE_CODE_WORKING_DIR ||
    process.env.HOME ||
    '/tmp'
  );
}

function resolveTimeoutMs() {
  const raw = process.env.EKYBOT_CLAUDE_CODE_TIMEOUT_MS;
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function resolveMaxOutput() {
  const raw = process.env.EKYBOT_CLAUDE_CODE_MAX_OUTPUT;
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MAX_OUTPUT_LENGTH;
}

function isEnabled(agentType) {
  if (agentType === 'claude-cowork') {
    return process.env.EKYBOT_CLAUDE_COWORK_ENABLED !== 'false';
  }
  return process.env.EKYBOT_CLAUDE_CODE_ENABLED !== 'false';
}

/**
 * Execute a one-shot Claude Code prompt and return the response.
 *
 * @param {string} message - The user's message from EkyBot
 * @param {object} options
 * @param {string} options.workingDir - Working directory for Claude Code
 * @param {number} options.timeoutMs - Timeout in milliseconds
 * @param {string} options.sessionId - Optional session ID for continuity (Level 2)
 * @param {string} options.agentType - 'claude-code' or 'claude-cowork'
 * @returns {Promise<{content: string, model: string, billingType: string, exitCode: number}>}
 */
async function executeClaudeCode(message, options = {}) {
  const {
    workingDir = resolveWorkingDir(options.agentType),
    timeoutMs = resolveTimeoutMs(),
    sessionId = null,
    agentType = 'claude-code',
  } = options;

  const maxOutput = resolveMaxOutput();

  if (!isEnabled(agentType)) {
    throw new Error(`${agentType} is disabled via environment config`);
  }

  console.log(
    chalk.cyan(
      `[claude-code] executing prompt in ${workingDir} (timeout=${Math.round(timeoutMs / 1000)}s, type=${agentType})`
    )
  );

  return new Promise((resolve, reject) => {
    const args = ['-p', message, '--output-format', 'text'];

    if (sessionId) {
      args.push('--session-id', sessionId);
    }

    // Enrich PATH for macOS LaunchAgent (which has minimal PATH: /usr/bin:/bin:/usr/sbin:/sbin)
    const enrichedEnv = { ...process.env };
    const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', `${process.env.HOME}/.nvm/versions/node/current/bin`];
    const currentPath = enrichedEnv.PATH || '/usr/bin:/bin';
    enrichedEnv.PATH = [...extraPaths, ...currentPath.split(':')].filter(Boolean).join(':');

    const proc = spawn('claude', args, {
      cwd: workingDir,
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
          console.log(
            chalk.cyan(
              `[claude-code] completed exitCode=${code} responseChars=${response.length}`
            )
          );
          resolve({
            content: response,
            model: 'anthropic/claude-code',
            billingType: 'subscription',
            exitCode: code,
          });
        } else {
          const errMsg = stderr.trim() || `Claude Code exited with code ${code}`;

          // Detect subscription rate limit
          if (
            stderr.includes('rate limit') ||
            stderr.includes('429') ||
            stderr.includes('too many')
          ) {
            console.warn(chalk.yellow(`[claude-code] rate limit hit`));
            resolve({
              content:
                '⏳ Rate limit atteint sur ton plan Claude. Réessaie dans quelques minutes.',
              model: 'anthropic/claude-code',
              billingType: 'subscription',
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
          reject(
            new Error(
              'Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code'
            )
          );
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
            model: 'anthropic/claude-code',
            billingType: 'subscription',
            exitCode: -1,
          });
        } else {
          reject(
            new Error(
              `Claude Code timed out after ${Math.round(timeoutMs / 1000)}s`
            )
          );
        }
      });
    }, timeoutMs);

    proc.on('close', () => clearTimeout(timer));
  });
}

/**
 * Check if Claude CLI is installed and authenticated.
 * @returns {Promise<{available: boolean, version: string|null, error: string|null}>}
 */
async function healthCheck() {
  return new Promise((resolve) => {
    const enrichedEnv = { ...process.env };
    const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', `${process.env.HOME}/.nvm/versions/node/current/bin`];
    const currentPath = enrichedEnv.PATH || '/usr/bin:/bin';
    enrichedEnv.PATH = [...extraPaths, ...currentPath.split(':')].filter(Boolean).join(':');

    const proc = spawn('claude', ['--version'], {
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
        console.log(
          chalk.green(`[claude-code] health OK: ${stdout.trim()}`)
        );
        resolve({
          available: true,
          version: stdout.trim(),
          error: null,
        });
      } else {
        resolve({
          available: false,
          version: null,
          error: 'Claude CLI not available or not authenticated',
        });
      }
    });
    proc.on('error', () => {
      resolve({
        available: false,
        version: null,
        error: 'Claude CLI not installed',
      });
    });
  });
}

/**
 * Returns true if the given provider string indicates a Claude Code agent.
 * @param {string|null|undefined} provider
 * @returns {boolean}
 */
function isClaudeCodeProvider(provider) {
  return provider === 'claude-code' || provider === 'claude-cowork';
}

module.exports = { executeClaudeCode, healthCheck, isClaudeCodeProvider };
