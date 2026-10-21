const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { runNativeTick } = require('../src/v2-native-machine');
const { writeDurableJson } = require('../src/hermes-resume-guard');
const { DurableConversationJournal } = require('../src/hermes-pilot-journal');
const { validSessionId } = require('../src/v2-codex-runtime');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ekybot-native-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const machineFile = path.join(root, 'machine.json');
  writeDurableJson(machineFile, { version: 1 });
  const calls = [];
  const options = {
    stateDir: path.join(root, 'state'),
    machineFile,
    home: root,
    machine: async (body) => {
      calls.push(body);
      return body.action === 'native-claim' ? { job: null } : { ok: true };
    },
    openConnection: async () => ({ rpc: { close: () => {} } }),
    claudeStatus: async () => ({ connected: false }),
  };
  return { root, options, calls };
}

test('native worker advertises only qualified Codex and can never claim the Hermes queue', async (t) => {
  const f = fixture(t);
  assert.deepEqual(await runNativeTick(f.options), { status: 'idle' });
  assert.deepEqual(
    f.calls.map((call) => call.action),
    ['native-capabilities', 'native-claim']
  );
  assert.equal(f.calls[0].claude, false);
  assert.equal(fs.existsSync(path.join(f.options.stateDir, 'worker.lock')), false);
});

test('failed native authentication disables capability without claiming a model job', async (t) => {
  const f = fixture(t);
  f.options.openConnection = async () => {
    throw new Error('auth unavailable');
  };
  assert.deepEqual(await runNativeTick(f.options), { status: 'native-auth-or-policy-required' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].codex, false);
});

test('a surviving worker lock never expires into an automatic restart', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.options.stateDir, { mode: 0o700 });
  fs.writeFileSync(path.join(f.options.stateDir, 'worker.lock'), 'fixture interrupted worker', {
    mode: 0o600,
  });
  assert.deepEqual(await runNativeTick(f.options), { status: 'worker-locked' });
  assert.equal(f.calls.length, 0);
});

test('native worker advertises a qualified subscription Claude independently of Codex', async (t) => {
  const f = fixture(t);
  f.options.openConnection = async () => {
    throw new Error('Codex unavailable');
  };
  f.options.claudeStatus = async () => ({ connected: true });
  assert.deepEqual(await runNativeTick(f.options), { status: 'idle' });
  assert.equal(f.calls[0].claude, true);
  assert.equal(f.calls[0].codex, false);
});

test('unqualified engine or binding cannot execute and remains uncertain', async (t) => {
  const f = fixture(t);
  const id = randomUUID();
  const job = { id: randomUUID(), channelId: id, agentId: id, engine: 'claude', mode: 'chat-only' };
  f.options.machine = async (body) => {
    f.calls.push(body);
    return body.action === 'native-claim' ? { job } : { ok: true };
  };
  await assert.rejects(runNativeTick(f.options), /Unqualified/);
  assert.equal(f.calls.at(-1).action, 'native-uncertain');
});

test('native outbox delivery survives provider logout and lost HTTP acknowledgement with zero generation', async (t) => {
  const f = fixture(t);
  const channelId = randomUUID();
  const sessionId = randomUUID();
  const journal = new DurableConversationJournal({
    stateDir: path.join(f.options.stateDir, channelId, 'journal'),
    channelId,
    profile: 'codex-chat-v1',
    homeRoot: f.root,
    assertFresh: async () => {},
    validSessionId,
    assertContinuation: () => {},
    execute: async () => ({ sessionId, output: 'Persisted fixture answer.' }),
    inspectSession: async () => ({}),
  });
  const job = { id: randomUUID(), channelId, text: 'Fixture message' };
  await journal.run(job);
  let authentication = 0;
  f.options.openConnection = async () => {
    authentication++;
    throw new Error('logged out');
  };
  let fail = true;
  f.options.machine = async (body) => {
    f.calls.push(body);
    if (fail) {
      throw new Error('lost receipt');
    }
    return { ok: true };
  };
  await assert.rejects(runNativeTick(f.options), /lost receipt/);
  fail = false;
  assert.deepEqual(await runNativeTick(f.options), { status: 'delivered', count: 1 });
  assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal(f.calls[0].action, 'native-complete');
  assert.equal(authentication, 0);
  assert.equal(journal.pendingDelivery().length, 0);
});
