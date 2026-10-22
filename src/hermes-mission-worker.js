// Separate scheduler and native profiles: never resumes the general Hermes chat.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { planFreshProfile, createFreshProfile } = require('./hermes-fresh-profile');
const {
  readActivation,
  readOpenAICredential,
  createPilotJournal,
} = require('./hermes-pilot-executor');
const { readAnthropicCredential } = require('./hermes-pilot-profile');
const { buildPilotExecutionConfig } = require('./hermes-pilot-routing');
const { readPrivateJson, writeDurableJson, HermesResumeGuard } = require('./hermes-resume-guard');
const { pilotTick } = require('./hermes-pilot-journal');
const { takeLock } = require('./development-pool');
const { createMachineClient } = require('./v2-machine-client');
const { openHermesMission } = require('./hermes-mission');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function prepareMission({ stateDir, job, source = {} }) {
  if (!UUID.test(job.missionId) || !UUID.test(job.channelId))
    throw new Error('Invalid mission identity');
  const options = { root: path.join(stateDir, 'native'), profile: `mission-${job.missionId}` };
  const plan = planFreshProfile(options);
  if (!fs.existsSync(plan.home)) {
    // Reuse ONLY the qualified runtime route, never source settings, auth files,
    // memories or sessions. Tokens are read privately at invocation time below.
    const { active } = readActivation(source);
    if (!active.webFingerprint) throw new Error('Qualified Web runtime required');
    createFreshProfile(options);
    const config = buildPilotExecutionConfig({ ...options, routingMode: 'openai-primary' });
    writeDurableJson(path.join(plan.home, 'config.yaml'), config);
    writeDurableJson(path.join(plan.home, 'web-policy.json'), {
      version: 1,
      enabled: true,
      maxRequests: 8,
    });
    writeDurableJson(path.join(plan.home, '.ekybot-pilot-active.json'), {
      version: 1,
      executionAllowed: true,
      channelId: job.channelId,
      mode: 'mission-v1',
      runtime: active.runtime,
      packages: active.packages,
      python: active.python,
      fingerprint: active.fingerprint,
      webFingerprint: active.webFingerprint,
      configHash: createHash('sha256').update(JSON.stringify(config)).digest('hex'),
      activatedAt: new Date().toISOString(),
    });
  }
  const { active } = readActivation(options);
  if (active.channelId !== job.channelId || active.mode !== 'mission-v1')
    throw new Error('Mission profile conflict');
  return options;
}

async function runMissionTick({
  stateDir,
  machineFile,
  machine: injected,
  source = {},
  prepare = prepareMission,
  journalFactory = createPilotJournal,
}) {
  if (![stateDir, machineFile].every((v) => typeof v === 'string' && path.isAbsolute(v)))
    throw new Error('Explicit mission configuration required');
  new HermesResumeGuard({ stateDir }).ensureDirectory();
  const lock = path.join(stateDir, 'worker.lock');
  if (!takeLock(lock)) return { status: 'worker-locked' };
  const workerId = randomUUID();
  const machine = injected || createMachineClient(readPrivateJson(machineFile));
  const call = (op, data = {}) => machine({ action: 'mission', op, data: { ...data, workerId } });
  const delivery = ({ action, ...data }) => call(action, data);
  let heartbeat, job;
  try {
    await call('publish', { version: 'missions-v1' });
    // Drain proven local results without credentials or any new model attempt.
    const profiles = path.join(stateDir, 'native', 'profiles');
    if (fs.existsSync(profiles))
      for (const profile of fs
        .readdirSync(profiles)
        .filter((p) => p.startsWith('mission-') && UUID.test(p.slice(8)))) {
        const journal = journalFactory({ root: path.join(stateDir, 'native'), profile });
        if (journal.pendingDelivery().length) await pilotTick({ journal, machine: delivery });
      }
    job = (await call('claim')).job;
    if (!job) return { status: 'idle' };
    heartbeat = setInterval(() => {
      void call('heartbeat', { runId: job.id }).catch(() => {});
      void call('publish', { version: 'missions-v1' }).catch(() => {});
    }, 30000);
    const options = prepare({ stateDir, job, source });
    const journal = journalFactory({
      ...options,
      getCredentials: () => ({
        credential: readOpenAICredential(readActivation(source).plan.home),
        fallbackCredential: readAnthropicCredential(source),
      }),
      openMission: (runId, plan) => openHermesMission({ machine, runId, workerId, plan, stateDir }),
    });
    return await pilotTick({
      journal,
      machine: (body) => (body.action === 'claim' ? Promise.resolve({ job }) : delivery(body)),
    });
  } catch (error) {
    // Even setup failures are not silently retried once a run was claimed.
    if (job) await call('uncertain', { runId: job.id }).catch(() => {});
    throw error;
  } finally {
    clearInterval(heartbeat);
    fs.unlinkSync(lock); // Scheduler lock only, never native conversation locks.
  }
}
module.exports = { prepareMission, runMissionTick };
