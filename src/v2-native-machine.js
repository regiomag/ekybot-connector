const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readPrivateJson, HermesResumeGuard } = require('./hermes-resume-guard');
const { createMachineClient } = require('./v2-machine-client');
const { DurableConversationJournal, pilotTick } = require('./hermes-pilot-journal');
const { openCodexChatConnection } = require('./v2-codex-connection');
const {
  CodexConversationRuntime,
  validSessionId,
  assertCodexContinuation,
} = require('./v2-codex-runtime');

// No provider secrets in this config. Only the existing scoped machine file path
// and a private V2 state root are required. Existing Hermes worker is untouched.
async function runNativeTick({
  stateDir,
  machineFile,
  home = os.homedir(),
  machine: injectedMachine,
  openConnection = openCodexChatConnection,
} = {}) {
  if (
    ![stateDir, machineFile, home].every(
      (value) => typeof value === 'string' && path.isAbsolute(value)
    )
  ) {
    throw new Error('Explicit native machine paths required');
  }
  new HermesResumeGuard({ stateDir }).ensureDirectory();
  const config = readPrivateJson(machineFile);
  if (config.version !== 1) {
    throw new Error('Unsupported machine configuration');
  }
  const machine = injectedMachine || createMachineClient(config);
  const lock = path.join(stateDir, 'worker.lock');
  let fd;
  try {
    fd = fs.openSync(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      return { status: 'worker-locked' };
    }
    throw error;
  }
  fs.writeFileSync(fd, String(process.pid));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  let connection;
  let heartbeat;
  const wrappedMachine = (body) => machine({ ...body, action: `native-${body.action}` });
  const journalFor = (id) => {
    if (!validSessionId(id)) {
      throw new Error('Invalid native channel');
    }
    const root = path.join(stateDir, id);
    new HermesResumeGuard({ stateDir: root }).ensureDirectory();
    let runtime;
    const getRuntime = async () => {
      if (!runtime) {
        connection?.rpc.close();
        connection = await openConnection({ cwd: root, home });
        runtime = new CodexConversationRuntime({ ...connection, cwd: root });
      }
      return runtime;
    };
    return new DurableConversationJournal({
      stateDir: path.join(root, 'journal'),
      channelId: id,
      profile: 'codex-chat-v1',
      homeRoot: home,
      assertFresh: async () => {},
      validSessionId,
      assertContinuation: assertCodexContinuation,
      inspectSession: async (args) => (await getRuntime()).inspectSession(args),
      execute: async (args) => (await getRuntime()).execute(args),
    });
  };
  try {
    // Delivery is independent of current provider authentication. Never make a
    // completed model turn again just because the HTTP acknowledgement was lost.
    const channels = fs.readdirSync(stateDir).filter(validSessionId);
    if (channels.length > 20) {
      throw new Error('Native connection limit exceeded');
    }
    for (const id of channels) {
      const journal = journalFor(id);
      if (journal.pendingDelivery().length) {
        return await pilotTick({ journal, machine: wrappedMachine });
      }
    }
    let ready = false;
    try {
      connection = await openConnection({ cwd: stateDir, home });
      ready = true;
    } catch {
      /* Report an unqualified provider, never silently select an API key. */
    }
    await machine({ action: 'native-capabilities', codex: ready, claude: false });
    if (!ready) {
      return { status: 'native-auth-or-policy-required' };
    }
    connection.rpc.close();
    connection = undefined;
    const claim = await wrappedMachine({ action: 'claim' });
    if (claim.blocked) {
      return { status: 'blocked' };
    }
    if (!claim.job) {
      return { status: 'idle' };
    }
    const job = claim.job;
    if (
      !validSessionId(job.channelId) ||
      job.agentId !== job.channelId ||
      job.engine !== 'codex' ||
      job.mode !== 'chat-only'
    ) {
      await wrappedMachine({ action: 'uncertain', runId: job.id });
      throw new Error('Unqualified native job');
    }
    // A bounded running turn can outlast the presence TTL; this is a heartbeat,
    // not a queue-polling loop, and is always cleared before the tick exits.
    heartbeat = setInterval(() => {
      void wrappedMachine({ action: 'heartbeat' }).catch(() => {});
    }, 30000);
    return await pilotTick({
      journal: journalFor(job.channelId),
      machine: (body) => (body.action === 'claim' ? Promise.resolve(claim) : wrappedMachine(body)),
    });
  } finally {
    clearInterval(heartbeat);
    connection?.rpc.close();
    fs.unlinkSync(lock);
  }
}
module.exports = { runNativeTick };
