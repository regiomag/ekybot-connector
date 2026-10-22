// Fail closed until an OS sandbox passes the native command qualification.
// The initial handwritten macOS profile could not run even a benign echo.
// Prefer qualifying a maintained sandbox runtime instead of relaxing that
// profile or silently executing a command with the Companion's credentials.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { redact } = require('./development-files');
async function runSandboxed({ root, command, args, timeoutMs = 120000 }) {
  if (
    process.platform !== 'darwin' ||
    typeof root !== 'string' ||
    !path.isAbsolute(root) ||
    fs.realpathSync(root) !== root ||
    root === '/' ||
    root === os.homedir() ||
    typeof command !== 'string' ||
    !path.isAbsolute(command) ||
    !Array.isArray(args) ||
    args.some((value) => typeof value !== 'string' || value.includes('\0')) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 600000
  ) {
    throw new Error('Invalid sandbox command');
  }
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ekybot-command-')));
  fs.chmodSync(scratch, 0o700);
  // No account credentials, NODE_OPTIONS, proxies, shell startup files or IPC
  // capabilities are inherited by the command runner.
  const child = fork(path.join(__dirname, '../scripts/development-command-child.mjs'), [], {
    env: {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      HOME: scratch,
      TMPDIR: scratch,
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  return new Promise((resolve, reject) => {
    let received = false;
    const timer = setTimeout(() => {
      child.disconnect();
      child.kill();
      reject(new Error('Sandbox worker interrupted; inspect before retry'));
    }, timeoutMs + 30000);
    child.once('error', reject);
    child.once('message', (result) => {
      received = true;
      clearTimeout(timer);
      if (result.error) reject(new Error(result.error));
      else resolve({ ...result, stdout: redact(result.stdout), stderr: redact(result.stderr) });
    });
    child.once('exit', () => {
      clearTimeout(timer);
      if (!received) reject(new Error('Sandbox worker failed; no unsandboxed retry'));
    });
    child.send({ root, scratch, command, args, timeoutMs });
  });
}
module.exports = { runSandboxed };
