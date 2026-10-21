const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { writeDurableJson } = require('../src/hermes-resume-guard');
const { runAuthTick } = require('../src/v2-auth-machine');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ekybot-auth-worker-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const machineFile = path.join(root, 'machine.json');
  writeDurableJson(machineFile, { version: 1 });
  return { stateDir: path.join(root, 'state'), machineFile, home: root };
}
test('auth worker is independent of chat queues and can be idle without provider calls', async (t) => {
  const calls = [];
  assert.deepEqual(
    await runAuthTick({
      ...fixture(t),
      machine: async (body) => {
        calls.push(body.action);
        return { job: null };
      },
      login: () => {
        throw new Error('must not execute');
      },
    }),
    { status: 'auth-idle' }
  );
  assert.deepEqual(calls, ['auth-claim']);
});
test('lost authentication acknowledgement replays a receipt without restarting login', async (t) => {
  const options = fixture(t);
  const id = randomUUID();
  let logins = 0,
    fail = true;
  const calls = [];
  const machine = async (body) => {
    calls.push(body);
    if (body.action === 'auth-claim') {
      return { job: { id, engine: 'claude' } };
    }
    if (fail) {
      throw new Error('lost ack');
    }
    return { ok: true };
  };
  const login = async () => {
    logins++;
    return { status: 'authenticated', reason: null };
  };
  await assert.rejects(runAuthTick({ ...options, machine, login }));
  fail = false;
  assert.deepEqual(await runAuthTick({ ...options, machine, login }), {
    status: 'auth-result-delivered',
    outcome: 'authenticated',
  });
  assert.equal(logins, 1);
  assert.deepEqual(calls[1], calls[2]);
});
test('a hard-crash auth lock is not expired into a second login', async (t) => {
  const options = fixture(t);
  fs.mkdirSync(options.stateDir, { mode: 0o700 });
  fs.writeFileSync(path.join(options.stateDir, 'auth.lock'), 'fixture', { mode: 0o600 });
  assert.deepEqual(
    await runAuthTick({
      ...options,
      machine: () => {
        throw new Error('must not claim');
      },
    }),
    { status: 'auth-worker-locked' }
  );
});
