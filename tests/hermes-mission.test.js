const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { openHermesMission } = require('../src/hermes-mission');
const { callToolServer } = require('../src/development-ipc');
const { runMissionTick } = require('../src/hermes-mission-worker');

function fixture(t) {
  const dir = fs.mkdtempSync('/private/tmp/em.');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('mission bridge exposes only scoped coordination and approved notebook tools', async (t) => {
  const dir = fixture(t);
  let allowed = true;
  const calls = [];
  const runId = randomUUID(),
    workerId = randomUUID(),
    target = randomUUID();
  const machine = async (body) => {
    calls.push(body);
    return body.op === 'context'
      ? {
          mission: allowed ? { id: randomUUID() } : null,
          project: { id: randomUUID(), name: 'Fixture' },
          canDelegate: true,
        }
      : { queued: true };
  };
  const bridge = await openHermesMission({
    machine,
    runId,
    workerId,
    stateDir: dir,
    plan: { home: dir, workspace: dir },
  });
  t.after(() => bridge.close());
  assert.deepEqual(bridge.definitions.map((t) => t.name).sort(), [
    'ekybot_memory_propose',
    'ekybot_memory_search',
    'ekybot_mission_delegate',
    'ekybot_mission_status',
  ]);
  await callToolServer(bridge.connection, {
    name: 'ekybot_mission_status',
    arguments: {},
    callId: 'status-fixture',
  });
  const request = {
    name: 'ekybot_mission_delegate',
    arguments: { target, task: 'Read the selected project' },
    callId: 'fixture-1',
  };
  await callToolServer(bridge.connection, request);
  await callToolServer(bridge.connection, request);
  assert.equal(calls.filter((c) => c.op === 'delegate').length, 1);
  assert.ok(calls.every((c) => c.data.runId === runId && c.data.workerId === workerId));
  allowed = false;
  await assert.rejects(callToolServer(bridge.connection, { ...request, callId: 'fixture-2' }));
  assert.equal(calls.filter((c) => c.op === 'delegate').length, 1);
});
test('final mission continuation cannot delegate', async (t) => {
  const dir = fixture(t);
  const bridge = await openHermesMission({
    stateDir: dir,
    runId: randomUUID(),
    workerId: randomUUID(),
    plan: { home: dir, workspace: dir },
    machine: async () => ({
      mission: { id: randomUUID() },
      project: { id: randomUUID(), name: 'Fixture' },
      canDelegate: false,
    }),
  });
  t.after(() => bridge.close());
  assert.equal(
    bridge.definitions.some((t) => t.name === 'ekybot_mission_delegate'),
    false
  );
});
test('dedicated worker invokes once, delivers and removes only scheduler lock', async (t) => {
  const dir = fixture(t),
    job = { id: randomUUID(), channelId: randomUUID(), missionId: randomUUID(), text: 'fixture' };
  const calls = [];
  let ran = 0,
    acked = 0;
  const result = await runMissionTick({
    stateDir: dir,
    machineFile: '/fixture/machine.json',
    machine: async (b) => {
      calls.push(b);
      return b.op === 'claim' ? { job } : { ok: true };
    },
    prepare: () => ({}),
    journalFactory: () => ({
      pendingDelivery: () => [],
      run: async (j) => {
        assert.deepEqual(j, job);
        ran++;
        return { id: job.id, output: 'fixture result', sessionId: '20261022_120000_abcdef' };
      },
      acknowledge: () => acked++,
    }),
  });
  assert.equal(result.status, 'delivered');
  assert.equal(ran, 1);
  assert.equal(acked, 1);
  assert.ok(calls.every((c) => c.action === 'mission'));
  assert.equal(calls.filter((c) => c.op === 'complete').length, 1);
  assert.equal(fs.existsSync(path.join(dir, 'worker.lock')), false);
});
test('setup failure fences claimed mission instead of retrying execution', async (t) => {
  const dir = fixture(t);
  const calls = [];
  const job = { id: randomUUID() };
  await assert.rejects(
    runMissionTick({
      stateDir: dir,
      machineFile: '/fixture/machine.json',
      machine: async (b) => {
        calls.push(b);
        return b.op === 'claim' ? { job } : { ok: true };
      },
      prepare: () => {
        throw new Error('fixture setup refusal');
      },
    })
  );
  assert.equal(calls.filter((c) => c.op === 'uncertain').length, 1);
  assert.equal(calls.filter((c) => c.op === 'complete').length, 0);
});
