#!/usr/bin/env node
// Explicit first-install only. Outputs identifiers + token hash, never credentials.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { activatePilot, runtimeFingerprint } = require('../src/hermes-pilot-executor');
const { planFreshProfile } = require('../src/hermes-fresh-profile');
const { writeDurableJson } = require('../src/hermes-resume-guard');
try {
  const [source, python, packages] = process.argv.slice(2);
  const destination = path.join(os.homedir(), '.local/share/ekybot-v2/runtime-05f548f35dd3');
  const plan = planFreshProfile();
  if (fs.existsSync(destination) || fs.existsSync(path.join(plan.home, 'machine.json')))
    {throw new Error('Existing installation');}
  const fingerprint = runtimeFingerprint(source);
  process.umask(0o077);
  fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
  if (runtimeFingerprint(destination) !== fingerprint) {throw new Error('Runtime copy mismatch');}
  const channelId = crypto.randomUUID();
  const machineId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  const result = activatePilot({ channelId, runtime: destination, python, packages });
  writeDurableJson(path.join(plan.home, 'machine.json'), {
    version: 1,
    channelId,
    machineId,
    token,
    endpoint: 'https://jvqwmqlpozqoscmcigqn.supabase.co/functions/v1/ekybot-v2-machine',
  });
  console.log(
    JSON.stringify({
      ...result,
      machineId,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    })
  );
} catch {
  console.error(JSON.stringify({ status: 'installation-stopped', modelInvoked: false }));
  process.exitCode = 1;
}
