const fs = require('node:fs');
const path = require('node:path');
const { HermesResumeGuard } = require('./hermes-resume-guard');
const { runDevelopmentTick } = require('./development-worker');

// Recover scheduler locks only when the recorded process is demonstrably gone.
// Native journal locks and receipts are NEVER removed or expired here.
function takeLock(file, alive = (pid) => process.kill(pid, 0)) {
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20) {
      return false;
    }
    const value = fs.readFileSync(file, 'utf8');
    if (!/^[1-9][0-9]{0,9}$/.test(value)) {
      return false;
    }
    try {
      alive(Number(value));
      return false;
    } catch (error) {
      if (error.code !== 'ESRCH') {
        return false;
      }
    }
    fs.unlinkSync(file);
  }
  try {
    fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

async function runDevelopmentPool({
  tick = runDevelopmentTick,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  durationMs = 20 * 60 * 1000,
  ...options
}) {
  new HermesResumeGuard({ stateDir: options.stateDir }).ensureDirectory();
  const lock = path.join(options.stateDir, 'worker.lock');
  if (!takeLock(lock)) {
    return { status: 'worker-locked' };
  }
  const until = Date.now() + durationMs;
  try {
    await Promise.all(
      [0, 1, 2].map(async (slot) => {
        const file = path.join(options.stateDir, `slot-${slot}.lock`);
        // A previous process crash may have left a scheduler lock, not permission
        // to replay its run: the server independently fences its expired lease.
        if (fs.existsSync(file)) {
          if (!takeLock(file)) {
            return;
          }
          fs.unlinkSync(file);
        }
        do {
          try {
            await tick({ ...options, slot, publish: slot === 0 });
          } catch {
            /* Redacted errors stay local to this slot; no turn replay. */
          }
          if (Date.now() >= until) {
            break;
          }
          await pause(3000);
        } while (Date.now() < until);
      })
    );
    return { status: 'pool-cycle-complete' };
  } finally {
    fs.unlinkSync(lock);
  }
}
module.exports = { runDevelopmentPool, takeLock };
