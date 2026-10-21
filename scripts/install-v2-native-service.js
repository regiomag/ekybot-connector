// Installs only the new native-chat service, never modifies the Hermes service.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildScheduledPlist } = require('../src/v2-scheduled-service');
const { readPrivateJson, HermesResumeGuard } = require('../src/hermes-resume-guard');
const { createMachineClient } = require('../src/v2-machine-client');

const label = 'com.ekybot.native-v2-chat';
function install() {
  const [release, stateDir, machineFile] = process.argv.slice(2);
  if (
    ![release, stateDir, machineFile].every(
      (value) => typeof value === 'string' && path.isAbsolute(value)
    )
  ) {
    throw new Error('Usage: install-v2-native-service ABSOLUTE_RELEASE PRIVATE_STATE MACHINE_FILE');
  }
  if (
    fs.realpathSync(release) !== release ||
    !fs.existsSync(path.join(release, 'scripts/v2-native-worker.js'))
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
    script: 'v2-native-worker.js',
    log: path.join(logs, 'worker.log'),
    errorLog: path.join(logs, 'error.log'),
    env: { EKYBOT_NATIVE_STATE_DIR: stateDir, EKYBOT_NATIVE_MACHINE_FILE: machineFile },
  });
  fs.writeFileSync(plistPath, plist, { flag: 'wx', mode: 0o600 });
  execFileSync('/usr/bin/plutil', ['-lint', plistPath], { stdio: 'ignore' });
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath], {
    stdio: 'ignore',
  });
  console.log(JSON.stringify({ installed: label, release, stateDir, credentialsCopied: false }));
}
try {
  install();
} catch (error) {
  console.error(JSON.stringify({ installed: false, code: error.code || 'INSTALL_FAILED' }));
  process.exitCode = 1;
}
