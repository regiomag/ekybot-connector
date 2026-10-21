#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { readActivation, createPilotJournal } = require('../src/hermes-pilot-executor');
const { LABEL, buildPilotPlist } = require('../src/hermes-pilot-service');
const { assertNoSymlinkChain, writeNew } = require('../src/hermes-fresh-profile');
try {
  const [action, release] = process.argv.slice(2);
  if (action !== '--install' || !release || process.platform !== 'darwin') {
    throw new Error('Use --install with an exported persistent release on macOS.');
  }
  const { plan } = readActivation();
  if (!createPilotJournal().binding()) {
    throw new Error('Qualify the native session first.');
  }
  assertNoSymlinkChain(release);
  if (
    !fs.existsSync(path.join(release, 'scripts/hermes-pilot-worker.js')) ||
    !fs.existsSync(path.join(release, 'node_modules/dotenv/package.json'))
  ) {
    throw new Error('Incomplete release');
  }
  const destination = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
  assertNoSymlinkChain(destination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  writeNew(destination, buildPilotPlist({ release, node: process.execPath, home: plan.home }));
  execFileSync('/usr/bin/plutil', ['-lint', destination], { stdio: 'ignore' });
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, destination], {
    stdio: 'ignore',
  });
  console.log(JSON.stringify({ status: 'service-installed', label: LABEL, intervalSeconds: 15 }));
} catch {
  console.error(JSON.stringify({ status: 'service-installation-stopped' }));
  process.exitCode = 1;
}
