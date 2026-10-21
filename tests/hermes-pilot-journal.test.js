const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { HermesPilotJournal, pilotTick } = require('../src/hermes-pilot-journal');
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const channelId = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const secondId = '33333333-3333-4333-8333-333333333333';
const sessionId = '20261021_153000_abcdef';
const job = { id, channelId, text: 'Test fictif' };
function fixture(overrides = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ekybot-pilot-test-'));
  roots.push(stateDir);
  let calls = 0,
    fresh = 0,
    count = 0;
  const options = {
    stateDir,
    channelId,
    profile: 'ekybot-v2-pilot',
    homeRoot: '/fake/hermes',
    assertFresh: async () => {
      fresh++;
    },
    execute: async (params) => {
      calls++;
      assert.equal(params.sessionId, calls === 1 ? null : sessionId);
      count += 2;
      return { sessionId, output: 'Réponse fictive' };
    },
    inspectSession: async () => ({
      sessionId,
      profile: 'ekybot-v2-pilot',
      home: '/fake/hermes',
      databaseIdentity: '1:2',
      activeMessages: count,
      lastMessageId: count,
    }),
    ...overrides,
  };
  return { options, journal: new HermesPilotJournal(options), counts: () => ({ calls, fresh }) };
}
test('first session is bound once; continuation uses the exact new ID', async () => {
  const f = fixture();
  await f.journal.run(job);
  await f.journal.run({ ...job, id: secondId });
  assert.deepEqual(f.counts(), { calls: 2, fresh: 1 });
  assert.equal(fs.statSync(path.join(f.options.stateDir, 'binding.json')).mode & 0o777, 0o600);
});
test('recreated journal replays completed result and accepts reordered fields', async () => {
  const f = fixture();
  const first = await f.journal.run(job);
  assert.deepEqual(
    await new HermesPilotJournal(f.options).run({ text: job.text, channelId, id }),
    first
  );
  assert.equal(f.counts().calls, 1);
  await assert.rejects(f.journal.run({ ...job, text: 'changed' }), {
    code: 'PILOT_REQUEST_CONFLICT',
  });
});
test('uncertain first turn blocks both same request and new IDs after restart', async () => {
  let calls = 0;
  const f = fixture({
    execute: async () => {
      calls++;
      throw Error('interrupted');
    },
  });
  await assert.rejects(f.journal.run(job), { code: 'PILOT_RECONCILIATION_REQUIRED' });
  const restarted = new HermesPilotJournal(f.options);
  await assert.rejects(restarted.run(job), { code: 'PILOT_RECONCILIATION_REQUIRED' });
  await assert.rejects(restarted.run({ ...job, id: secondId }), {
    code: 'PILOT_RECONCILIATION_REQUIRED',
  });
  assert.equal(calls, 1);
});
test('concurrent first requests cannot create two sessions', async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({
    execute: async () => {
      await waiting;
      return { sessionId, output: 'Ok' };
    },
  });
  const first = f.journal.run(job);
  await assert.rejects(new HermesPilotJournal(f.options).run({ ...job, id: secondId }), {
    code: 'PILOT_RECONCILIATION_REQUIRED',
  });
  release();
  await first;
});
test('outbox survives lost delivery acknowledgement without another execution', async () => {
  const f = fixture();
  let deliveries = 0,
    claims = 0;
  const machine = async (request) => {
    if (request.action === 'claim') {
      claims++;
      return { job };
    }
    assert.equal(request.action, 'complete');
    deliveries++;
    if (deliveries === 1) {
      throw Error('lost acknowledgement');
    }
    return { ok: true, replayed: true };
  };
  await assert.rejects(pilotTick({ journal: f.journal, machine }), /lost acknowledgement/);
  assert.equal(f.journal.pendingDelivery().length, 1);
  assert.deepEqual(await pilotTick({ journal: new HermesPilotJournal(f.options), machine }), {
    status: 'delivered',
    count: 1,
  });
  assert.deepEqual(f.counts(), { calls: 1, fresh: 1 });
  assert.equal(claims, 1);
  assert.equal(deliveries, 2);
  assert.equal(f.journal.pendingDelivery().length, 0);
});
test('uncertain execution is reported to the backend, not published', async () => {
  const f = fixture({
    execute: async () => {
      throw Error('timeout');
    },
  });
  const actions = [];
  await assert.rejects(
    pilotTick({
      journal: f.journal,
      machine: async (request) => {
        actions.push(request.action);
        return { job };
      },
    }),
    { code: 'PILOT_RECONCILIATION_REQUIRED' }
  );
  assert.deepEqual(actions, ['claim', 'uncertain']);
});
test('a process exiting during first creation cannot be restarted as a fresh model call', async () => {
  const f = fixture();
  const child = spawnSync(process.execPath, [
    '-e',
    `
    const {HermesPilotJournal}=require(${JSON.stringify(require.resolve('../src/hermes-pilot-journal'))});
    const journal=new HermesPilotJournal({...${JSON.stringify(f.options)},assertFresh:async()=>{},execute:async()=>process.exit(17)});
    journal.run(${JSON.stringify(job)});
  `,
  ]);
  assert.equal(child.status, 17);
  await assert.rejects(new HermesPilotJournal(f.options).run(job), {
    code: 'PILOT_RECONCILIATION_REQUIRED',
  });
  assert.equal(f.counts().calls, 0);
});
test('revoked binding blocks replay and pending delivery', async () => {
  const f = fixture();
  await f.journal.run(job);
  fs.unlinkSync(path.join(f.options.stateDir, 'binding.json'));
  await assert.rejects(f.journal.run(job), { code: 'PILOT_BINDING_CONFLICT' });
  assert.throws(() => f.journal.pendingDelivery(), { code: 'PILOT_OUTBOX_INVALID' });
});
test('foreign channel and non-fresh profile fail before model invocation', async () => {
  const f = fixture({
    assertFresh: async () => {
      throw Error('profile not fresh');
    },
  });
  await assert.rejects(f.journal.run({ ...job, channelId: secondId }), {
    code: 'PILOT_JOB_INVALID',
  });
  await assert.rejects(f.journal.run(job), /profile not fresh/);
  assert.equal(f.counts().calls, 0);
  assert.equal(fs.existsSync(path.join(f.options.stateDir, 'conversation.lock')), false);
});
test('empty output, session changes and unpersisted history remain blocked', async () => {
  for (const result of [
    { sessionId, output: '' },
    { sessionId: 'latest', output: 'Ok' },
  ]) {
    const f = fixture({ execute: async () => result });
    await assert.rejects(f.journal.run(job), { code: 'PILOT_RECONCILIATION_REQUIRED' });
    assert.equal(f.journal.pendingDelivery().length, 0);
  }
  const f = fixture();
  await f.journal.run(job);
  f.journal.execute = async () => ({ sessionId, output: 'No persistence' });
  await assert.rejects(f.journal.run({ ...job, id: secondId }), {
    code: 'PILOT_RECONCILIATION_REQUIRED',
  });
});
