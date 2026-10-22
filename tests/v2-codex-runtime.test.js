const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { CodexConversationRuntime, assertCodexContinuation } = require('../src/v2-codex-runtime');

function fixture({
  beforeAck = false,
  status = 'completed',
  wrongClient = false,
  noFinal = false,
} = {}) {
  const id = randomUUID();
  const tree = randomUUID();
  const calls = [];
  const listeners = new Set();
  const turns = [];
  const thread = { id, sessionId: tree, cwd: '/fixture/project', ephemeral: false, turns: [] };
  const emit = (method, params) => {
    for (const listener of listeners) {
      listener({ method, params });
    }
  };
  const rpc = {
    onEvent: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close: () => emit('ekybot/closed', {}),
    request: async (method, params) => {
      calls.push({ method, params });
      if (['thread/start', 'thread/resume', 'thread/read'].includes(method)) {
        return { thread };
      }
      if (method === 'thread/turns/list') {
        return { data: turns, nextCursor: null };
      }
      if (method === 'turn/start') {
        const turn = {
          id: randomUUID(),
          status,
          itemsView: 'full',
          items: [
            {
              type: 'userMessage',
              clientId: wrongClient ? randomUUID() : params.clientUserMessageId,
              content: params.input,
            },
            {
              type: 'agentMessage',
              phase: noFinal ? 'commentary' : 'final_answer',
              text: 'Verified answer.',
            },
          ],
        };
        turns.push(turn);
        const done = () => emit('turn/completed', { threadId: id, turn });
        if (beforeAck) {
          done();
        } else {
          setImmediate(done);
        }
        return { turn };
      }
      throw new Error('Unexpected method');
    },
  };
  const runtime = new CodexConversationRuntime({
    rpc,
    cwd: thread.cwd,
    assertPolicy: async () => {},
    timeoutMs: 50,
  });
  return { id, rpc, runtime, calls, turns, thread, listeners, emit };
}

test('Codex new session and exact resume verify persisted content, not partial events', async () => {
  const f = fixture();
  const first = await f.runtime.execute({
    input: 'Remember a fixture nonce',
    sessionId: null,
    jobId: randomUUID(),
  });
  const before = await f.runtime.inspectSession({ sessionId: first.sessionId });
  await f.runtime.execute({ input: 'Recall it', sessionId: first.sessionId, jobId: randomUUID() });
  const after = await f.runtime.inspectSession({ sessionId: first.sessionId });
  assertCodexContinuation(before, after);
  assert.equal(f.calls.filter((call) => call.method === 'thread/start').length, 1);
  assert.equal(f.calls.find((call) => call.method === 'thread/resume').params.threadId, f.id);
  assert.equal(f.listeners.size, 0);
});

test('Codex completion before turn acknowledgement is reconciled by exact turn ID', async () => {
  const f = fixture({ beforeAck: true });
  assert.equal(
    (await f.runtime.execute({ input: 'Hi', sessionId: null, jobId: randomUUID() })).output,
    'Verified answer.'
  );
});

test('pinned Codex tools are configured at creation, never silently replaced on resume', async () => {
  const f = fixture();
  const tools = [
    {
      name: 'ekybot_memory_search',
      description: 'Fixture',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
  f.runtime.development = { tools, instructions: 'Fixture only', bind() {} };
  await f.runtime.execute({ input: 'First', sessionId: null, jobId: randomUUID() });
  await f.runtime.execute({ input: 'Continue', sessionId: f.id, jobId: randomUUID() });
  assert.equal(
    f.calls.find((c) => c.method === 'thread/start').params.dynamicTools[0].name,
    tools[0].name
  );
  const resumed = f.calls.find((c) => c.method === 'thread/resume').params;
  assert.equal(Object.hasOwn(resumed, 'dynamicTools'), false);
  assert.equal(Object.hasOwn(resumed, 'allowProviderModelFallback'), false);
  assert.equal(resumed.threadId, f.id);
});

for (const options of [
  { status: 'failed' },
  { status: 'interrupted' },
  { wrongClient: true },
  { noFinal: true },
]) {
  test(`Codex rejects unverified result ${JSON.stringify(options)} without retry`, async () => {
    const f = fixture(options);
    await assert.rejects(f.runtime.execute({ input: 'Hi', sessionId: null, jobId: randomUUID() }));
    assert.equal(f.calls.filter((call) => call.method === 'turn/start').length, 1);
    assert.equal(f.listeners.size, 0);
  });
}

test('Codex refuses foreign, ephemeral or branched threads and invalid IDs before generation', async () => {
  for (const patch of [{ cwd: '/another' }, { ephemeral: true }, { forkedFromId: randomUUID() }]) {
    const f = fixture();
    Object.assign(f.thread, patch);
    await assert.rejects(f.runtime.execute({ input: 'Hi', sessionId: f.id, jobId: randomUUID() }));
    assert.equal(
      f.calls.some((call) => call.method === 'turn/start'),
      false
    );
  }
  const f = fixture();
  await assert.rejects(
    f.runtime.execute({ input: 'Hi', sessionId: 'latest', jobId: randomUUID() })
  );
  assert.equal(f.calls.length, 0);
});

test('Codex cannot start any native session if its launch policy is not qualified', async () => {
  const f = fixture();
  f.runtime.assertPolicy = async () => {
    throw new Error('Policy not qualified');
  };
  await assert.rejects(f.runtime.execute({ input: 'Hi', sessionId: null, jobId: randomUUID() }));
  assert.equal(f.calls.length, 0);
});

test('Codex continuation rejects lost or rewritten history and changed session tree', () => {
  const before = { sessionId: 'a', treeId: 'b', cwd: 'c', turns: [{ id: '1', hash: 'original' }] };
  for (const after of [
    before,
    { ...before, treeId: 'other', turns: [...before.turns, {}] },
    { ...before, turns: [{ id: '1', hash: 'rewritten' }, {}] },
  ]) {
    assert.throws(() => assertCodexContinuation(before, after));
  }
});

test('Codex lost acknowledgement stays uncertain and never starts a replacement turn', async () => {
  const f = fixture();
  const original = f.rpc.request;
  f.rpc.request = async (method, params) => {
    if (method === 'turn/start') {
      throw new Error('lost acknowledgement');
    }
    return original(method, params);
  };
  await assert.rejects(f.runtime.execute({ input: 'Hi', sessionId: null, jobId: randomUUID() }), {
    code: 'CODEX_TURN_UNCERTAIN',
  });
  assert.equal(f.calls.filter((call) => call.method === 'thread/start').length, 1);
  assert.equal(f.listeners.size, 0);
});
