const path = require('node:path');
const { readPrivateJson } = require('./hermes-resume-guard');
const { readActivation, createPilotJournal } = require('./hermes-pilot-executor');
const { pilotTick } = require('./hermes-pilot-journal');
const { ENDPOINT, createMachineClient } = require('./v2-machine-client');

async function runMachineTick(options = {}) {
  const { plan, active } = readActivation(options);
  const config = readPrivateJson(path.join(plan.home, 'machine.json'));
  if (
    config.version !== 1 ||
    config.channelId !== active.channelId ||
    config.endpoint !== ENDPOINT ||
    !/^[a-f0-9]{64}$/.test(config.token)
  ) {
    throw new Error('Invalid scoped machine configuration');
  }
  const machine = createMachineClient(config);
  const heartbeat = setInterval(() => {
    void machine({ action: 'heartbeat' }).catch(() => {});
  }, 30000);
  try {
    return await pilotTick({ journal: createPilotJournal(options), machine });
  } finally {
    clearInterval(heartbeat);
  }
}
module.exports = { runMachineTick };
