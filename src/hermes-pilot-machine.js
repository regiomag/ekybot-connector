const path = require('node:path');
const { readPrivateJson } = require('./hermes-resume-guard');
const { readActivation, createPilotJournal } = require('./hermes-pilot-executor');
const { pilotTick } = require('./hermes-pilot-journal');
const ENDPOINT = 'https://jvqwmqlpozqoscmcigqn.supabase.co/functions/v1/ekybot-v2-machine';

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
  const machine = async (body) => {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(25000),
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {throw new Error('Machine request unconfirmed');}
    return response.json();
  };
  return pilotTick({ journal: createPilotJournal(options), machine });
}
module.exports = { runMachineTick };
