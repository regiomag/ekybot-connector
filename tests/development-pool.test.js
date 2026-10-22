const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { runDevelopmentPool, takeLock } = require('../src/development-pool');
const { DevelopmentBroker } = require('../src/development-broker');

test('a waiting approval and a failed session do not prevent the third slot from working', async () => {
  const stateDir = fs.mkdtempSync('/private/tmp/ekydev-pool-');
  const started = [];
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const result = await runDevelopmentPool({
    stateDir,
    durationMs: 0,
    tick: async ({ slot }) => {
      started.push(slot);
      if (slot === 0) {
        await waiting;
      }
      if (slot === 1) {
        throw new Error('Uncertain native turn');
      }
      if (slot === 2) {
        release();
      }
    },
  });
  assert.equal(result.status, 'pool-cycle-complete');
  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(fs.existsSync(path.join(stateDir, 'worker.lock')), false);
});
test('scheduler recovers only a provably dead PID; native journal locks stay intact', () => {
  const root = fs.mkdtempSync('/private/tmp/ekydev-pool-lock-');
  const file = path.join(root, 'worker.lock'),
    journal = path.join(root, 'conversation.lock');
  fs.writeFileSync(file, '123');
  fs.writeFileSync(journal, 'native-proof');
  assert.equal(
    takeLock(file, () => {}),
    false
  );
  assert.equal(
    takeLock(file, () => {
      throw Object.assign(new Error(), { code: 'EPERM' });
    }),
    false
  );
  assert.equal(
    takeLock(file, () => {
      throw Object.assign(new Error(), { code: 'ESRCH' });
    }),
    true
  );
  assert.equal(fs.readFileSync(journal, 'utf8'), 'native-proof');
});
test('revocation fences reads, writes and replayed tool results', async () => {
  const root = fs.mkdtempSync('/private/tmp/ekydev-revoke-');
  let revoked = false;
  const broker = new DevelopmentBroker({
    root,
    stateDir: path.join(root, 'state'),
    runId: randomUUID(),
    role: 'developer',
    projects: [],
    approve: async () => true,
    cancelled: async () => revoked,
  });
  const input = { path: 'fixture.txt', oldText: '', newText: 'first' };
  await broker.call('ekybot_edit', input, 'same-call');
  revoked = true;
  await assert.rejects(broker.call('ekybot_edit', input, 'same-call'), /cancelled/);
  await assert.rejects(broker.call('ekybot_read', { path: 'fixture.txt' }), /cancelled/);
  assert.equal(fs.readFileSync(path.join(root, 'fixture.txt'), 'utf8'), 'first');
});
test('revocation while waiting for approval prevents the approved command', async () => {
  const root = fs.mkdtempSync('/private/tmp/ekydev-approval-revoke-');
  let revoked = false,
    calls = 0;
  const broker = new DevelopmentBroker({
    root,
    stateDir: path.join(root, 'state'),
    runId: randomUUID(),
    role: 'developer',
    projects: [],
    cancelled: async () => revoked,
    approve: async () => {
      revoked = true;
      return true;
    },
    runCommand: async () => {
      calls++;
      return {};
    },
  });
  await broker.call('ekybot_exec', { command: '/bin/echo', args: ['test'], reason: 'Fixture' });
  assert.equal(calls, 0);
});
