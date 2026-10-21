const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { HermesResumeGuard, readPrivateJson, writeDurableJson } = require('./hermes-resume-guard');
const { createMachineClient } = require('./v2-machine-client');
const { validSessionId } = require('./v2-codex-runtime');
const { loginClaude } = require('./v2-claude-login');

// Independent from chat workers. Authentication never claims or executes a model job.
async function runAuthTick({
  stateDir,
  machineFile,
  home = os.homedir(),
  machine: injectedMachine,
  login = loginClaude,
}) {
  if (
    ![stateDir, machineFile, home].every(
      (value) => typeof value === 'string' && path.isAbsolute(value)
    )
  ) {
    throw new Error('Explicit auth paths required');
  }
  new HermesResumeGuard({ stateDir }).ensureDirectory();
  const config = readPrivateJson(machineFile);
  if (config.version !== 1) {
    throw new Error('Invalid machine configuration');
  }
  const machine = injectedMachine || createMachineClient(config);
  const lock = path.join(stateDir, 'auth.lock');
  let fd;
  try {
    fd = fs.openSync(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      return { status: 'auth-worker-locked' };
    }
    throw error;
  }
  fs.writeFileSync(fd, String(process.pid));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  const outbox = path.join(stateDir, 'result.json');
  const deliver = async () => {
    const result = readPrivateJson(outbox);
    if (
      !validSessionId(result.requestId) ||
      !['authenticated', 'failed', 'expired'].includes(result.status) ||
      ![
        null,
        'different_auth_method',
        'authorization_expired',
        'authorization_unavailable',
        'authorization_not_confirmed',
      ].includes(result.reason)
    ) {
      throw new Error('Invalid auth receipt');
    }
    await machine({
      action: 'auth-finish',
      requestId: result.requestId,
      status: result.status,
      reason: result.reason,
    });
    fs.unlinkSync(outbox);
    return { status: 'auth-result-delivered', outcome: result.status };
  };
  try {
    if (fs.existsSync(outbox)) {
      return await deliver();
    }
    const { job } = await machine({ action: 'auth-claim' });
    if (!job) {
      return { status: 'auth-idle' };
    }
    if (!validSessionId(job.id) || job.engine !== 'claude') {
      throw new Error('Invalid auth request');
    }
    const directory = path.join(stateDir, job.id);
    if (fs.existsSync(directory)) {
      throw new Error('Authentication already attempted; manual reconciliation required');
    }
    new HermesResumeGuard({ stateDir: directory }).ensureDirectory();
    let result;
    try {
      result = await login({
        home,
        directory,
        onAuthorize: (url) => machine({ action: 'auth-publish', requestId: job.id, url }),
      });
    } catch {
      result = { status: 'failed', reason: 'authorization_unavailable' };
    }
    writeDurableJson(outbox, { requestId: job.id, ...result });
    return await deliver();
  } finally {
    fs.unlinkSync(lock);
  }
}
module.exports = { runAuthTick };
