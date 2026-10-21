const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildScheduledPlist } = require('./v2-scheduled-service');
const { readPrivateJson, HermesResumeGuard } = require('./hermes-resume-guard');
const { createMachineClient } = require('./v2-machine-client');
function installNativeService({ label, script, stateVariable, release, stateDir, machineFile }) {
  if (
    ![release, stateDir, machineFile].every(
      (value) => typeof value === 'string' && path.isAbsolute(value)
    )
  ) {
    throw new Error('Explicit absolute paths required');
  }
  if (
    fs.realpathSync(release) !== release ||
    !fs.existsSync(path.join(release, 'scripts', script))
  ) {
    throw new Error('Invalid persistent release');
  }
  const config = readPrivateJson(machineFile);
  createMachineClient(config);
  if (config.version !== 1) {
    throw new Error('Invalid machine configuration');
  }
  new HermesResumeGuard({ stateDir }).ensureDirectory();
  const logs = path.join(stateDir, 'logs');
  new HermesResumeGuard({ stateDir: logs }).ensureDirectory();
  const plistPath = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
  if (fs.existsSync(plistPath)) {
    throw new Error('Service already installed; explicit upgrade required');
  }
  const plist = buildScheduledPlist({
    label,
    release,
    node: process.execPath,
    cwd: stateDir,
    script,
    log: path.join(logs, 'worker.log'),
    errorLog: path.join(logs, 'error.log'),
    env: { [stateVariable]: stateDir, EKYBOT_NATIVE_MACHINE_FILE: machineFile },
  });
  fs.writeFileSync(plistPath, plist, { flag: 'wx', mode: 0o600 });
  execFileSync('/usr/bin/plutil', ['-lint', plistPath], { stdio: 'ignore' });
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath], {
    stdio: 'ignore',
  });
  return { installed: label, release, stateDir, credentialsCopied: false };
}
module.exports = { installNativeService };
