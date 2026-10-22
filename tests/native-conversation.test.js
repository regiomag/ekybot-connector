const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  createNativeConversationJournal,
  createScopedNativeConversationJournal,
  scopedConversationProfile,
} = require('../src/native-conversation');
const { pilotTick } = require('../src/hermes-pilot-journal');

function fixture(t, engine = 'codex') {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'native-common-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scope = {
    engine,
    ownerId: randomUUID(),
    projectId: randomUUID(),
    agentId: randomUUID(),
    channelId: randomUUID(),
    connectionId: randomUUID(),
    grantRevision: '1',
    policyVersion: 'v1',
  };
  const sessionId = randomUUID();
  const calls = [];
  const turns = [];
  let opened = 0;
  const runtime = {
    execute: async (args) => {
      calls.push(args);
      turns.push({ id: args.jobId, hash: args.input });
      return { sessionId, output: 'Verified fixture response' };
    },
    inspectSession: async () =>
      engine === 'codex'
        ? { sessionId, treeId: 'tree', cwd: root, turns: structuredClone(turns) }
        : {
            sessionId,
            cwd: root,
            identity: '1:2',
            users: turns.length,
            messages: structuredClone(turns),
          },
  };
  const options = {
    engine,
    stateDir: path.join(root, 'journal'),
    channelId: scope.channelId,
    profile: scopedConversationProfile(scope),
    homeRoot: root,
    getRuntime: () => {
      opened++;
      return runtime;
    },
  };
  const job = { id: randomUUID(), channelId: scope.channelId, text: 'First fixture request' };
  return { scope, options, job, calls, runtime, turns, opened: () => opened };
}

for (const engine of ['codex', 'claude']) {
  test(`${engine}: common journal starts once and resumes the exact native session`, async (t) => {
    const f = fixture(t, engine);
    const journal = createNativeConversationJournal(f.options);
    assert.equal(f.opened(), 0);
    const first = await journal.run(f.job);
    await journal.run({ ...f.job, id: randomUUID(), text: 'Follow-up only' });
    assert.equal(f.opened(), 1);
    assert.equal(f.calls[0].sessionId, null);
    assert.equal(f.calls[1].sessionId, first.sessionId);
    assert.equal(f.calls[1].input, 'Follow-up only');
  });

  test(`${engine}: provider logout cannot prevent outbox delivery or regenerate output`, async (t) => {
    const f = fixture(t, engine);
    await createNativeConversationJournal(f.options).run(f.job);
    let auth = 0;
    const journal = createNativeConversationJournal({
      ...f.options,
      getRuntime: () => {
        auth++;
        throw new Error('Provider is disconnected');
      },
    });
    await assert.rejects(
      pilotTick({
        journal,
        machine: async () => {
          throw new Error('Lost ACK');
        },
      }),
      /Lost ACK/
    );
    const delivered = [];
    await pilotTick({
      journal,
      machine: async (body) => {
        delivered.push(body);
        return { ok: true };
      },
    });
    assert.equal(auth, 0);
    assert.equal(f.calls.length, 1);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].action, 'complete');
    assert.equal(journal.pendingDelivery().length, 0);
  });

  test(`${engine}: altered native history fails closed without falling back`, async (t) => {
    const f = fixture(t, engine);
    const journal = createNativeConversationJournal(f.options);
    await journal.run(f.job);
    const execute = f.runtime.execute;
    f.runtime.execute = async (args) => {
      f.turns[0].hash = 'unexpected rewrite';
      return execute(args);
    };
    await assert.rejects(journal.run({ ...f.job, id: randomUUID() }), {
      code: 'PILOT_RECONCILIATION_REQUIRED',
    });
    await assert.rejects(journal.run({ ...f.job, id: randomUUID() }), {
      code: 'PILOT_RECONCILIATION_REQUIRED',
    });
    assert.equal(f.opened(), 1);
    assert.equal(f.calls.length, 2);
  });
}

for (const field of [
  'ownerId',
  'projectId',
  'agentId',
  'connectionId',
  'grantRevision',
  'policyVersion',
  'engine',
]) {
  test(`a changed ${field} cannot read or resume another binding`, async (t) => {
    const f = fixture(t);
    await createNativeConversationJournal(f.options).run(f.job);
    const value = field === 'engine' ? 'claude' : field.endsWith('Id') ? randomUUID() : 'next';
    const profile = scopedConversationProfile({ ...f.scope, [field]: value });
    assert.notEqual(profile, f.options.profile);
    const changed = createNativeConversationJournal({ ...f.options, profile });
    assert.throws(() => changed.pendingDelivery(), { code: 'PILOT_OUTBOX_INVALID' });
    await assert.rejects(changed.run({ ...f.job, id: randomUUID() }), {
      code: 'PILOT_BINDING_CONFLICT',
    });
    assert.equal(f.calls.length, 1);
  });
}

test('scope is canonical, opaque, bounded, and does not accept an external Cowork engine', (t) => {
  const f = fixture(t);
  const reversed = Object.fromEntries(Object.entries(f.scope).reverse());
  assert.equal(scopedConversationProfile(reversed), f.options.profile);
  assert.equal(f.options.profile.includes(f.scope.ownerId), false);
  assert.notEqual(
    scopedConversationProfile({ ...f.scope, channelId: randomUUID() }),
    f.options.profile
  );
  for (const scope of [
    { ...f.scope, ownerId: '../other' },
    { ...f.scope, policyVersion: '' },
    { ...f.scope, grantRevision: 'x'.repeat(101) },
  ]) {
    assert.throws(() => scopedConversationProfile(scope), /Invalid/);
  }
  for (const engine of ['cowork', 'constructor', '__proto__', null]) {
    assert.throws(() => createNativeConversationJournal({ ...f.options, engine }), /Unsupported/);
    assert.throws(() => scopedConversationProfile({ ...f.scope, engine }), /Invalid/);
  }
});

test('failed lazy opening is retained, not retried by concurrent inspections', async (t) => {
  const f = fixture(t);
  let attempts = 0;
  const journal = createNativeConversationJournal({
    ...f.options,
    getRuntime: () => {
      attempts++;
      throw new Error('Unavailable');
    },
  });
  const results = await Promise.allSettled([
    journal.inspectSession({}),
    journal.inspectSession({}),
  ]);
  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.equal(attempts, 1);
});

test('incomplete adapters and attempts to override the proof fail closed', async (t) => {
  const f = fixture(t);
  const journal = createNativeConversationJournal({
    ...f.options,
    getRuntime: () => ({ execute: () => {} }),
    execute: () => assert.fail('override'),
  });
  await assert.rejects(journal.run(f.job), { code: 'PILOT_RECONCILIATION_REQUIRED' });
});

test('multi-user entry point binds the authenticated scope, ignoring caller profile overrides', async (t) => {
  const f = fixture(t);
  const journal = createScopedNativeConversationJournal({
    ...f.options,
    scope: f.scope,
    profile: 'unsafe',
  });
  assert.equal(journal.profile, scopedConversationProfile(f.scope));
  await journal.run(f.job);
  const foreign = createScopedNativeConversationJournal({
    ...f.options,
    scope: { ...f.scope, ownerId: randomUUID() },
  });
  await assert.rejects(foreign.run({ ...f.job, id: randomUUID() }), {
    code: 'PILOT_BINDING_CONFLICT',
  });
  assert.equal(f.calls.length, 1);
});
