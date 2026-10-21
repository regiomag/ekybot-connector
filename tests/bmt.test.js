const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const broker = require('../src/bmt-broker');
const { runBmtTick, planAgent, stepId } = require('../src/bmt-worker');
const { writeDurableJson } = require('../src/hermes-resume-guard');
const { claudeArguments } = require('../src/v2-claude-runtime');
const key = 'bmt_fixture_only_not_a_real_key_123456789';
const connection = {
  id: crypto.randomUUID(),
  owner_id: crypto.randomUUID(),
  agent_id: crypto.randomUUID(),
  status: 'ready',
  scopes: ['crm:read', 'crm:write', 'accounting:read'],
  project_id: crypto.randomUUID(),
  label: 'Fixture A',
};
function sealed(pair, c = connection) {
  const identity = [c.owner_id, c.agent_id, c.id],
    aes = crypto.randomBytes(32),
    iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', aes, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(identity)));
  const text = Buffer.concat([cipher.update(key), cipher.final(), cipher.getAuthTag()]);
  return {
    version: 1,
    keyId: pair.keyId,
    identity,
    iv: iv.toString('base64'),
    ciphertext: text.toString('base64'),
    wrapped: crypto
      .publicEncrypt(
        { key: crypto.createPublicKey({ key: pair.publicKey, format: 'jwk' }), oaepHash: 'sha256' },
        aes
      )
      .toString('base64'),
  };
}
test('sealed project keys bind owner, agent and connection; tamper/swap fails closed', () => {
  const pair = broker.keys(),
    env = sealed(pair),
    id = [connection.owner_id, connection.agent_id, connection.id];
  assert.equal(broker.decrypt(env, id, pair), key);
  assert.throws(() => broker.decrypt(env, [id[0], crypto.randomUUID(), id[2]], pair));
  assert.throws(() =>
    broker.decrypt({ ...env, iv: crypto.randomBytes(12).toString('base64') }, id, pair)
  );
  assert.throws(() => broker.decrypt({ ...env, keyId: 'wrong' }, id, pair));
  assert.ok(!JSON.stringify(env).includes(key));
});
test('GET business mutations require approval and unknown operations cannot run', () => {
  const plan = broker.requestPlan(
    { connectionId: connection.id, api: 'accounting', action: 'vat_return' },
    connection
  );
  assert.equal(plan.method, 'GET');
  assert.equal(plan.operation.effect, 'update');
  assert.throws(() =>
    broker.requestPlan(
      { connectionId: connection.id, api: 'accounting', action: 'execute' },
      connection
    )
  );
});
test('scope, target, override, path traversal and credential injection are refused', () => {
  const command = { connectionId: connection.id, api: 'crm', action: 'contacts' };
  assert.throws(() =>
    broker.requestPlan({ ...command, connectionId: crypto.randomUUID() }, connection)
  );
  assert.throws(() => broker.requestPlan(command, { ...connection, status: 'disabled' }));
  assert.throws(() => broker.requestPlan(command, { ...connection, scopes: [] }));
  for (const params of [
    { project_id: crypto.randomUUID() },
    { headers: { authorization: key } },
    { action: 'delete' },
    { url: 'https://attacker.invalid' },
  ]) {
    assert.throws(() => broker.requestPlan({ ...command, params }, connection));
  }
  assert.throws(() => broker.requestPlan({ ...command, id: '../other' }, connection));
  assert.throws(() =>
    broker.requestPlan({ ...command, url: 'https://attacker.invalid' }, connection)
  );
});
test('fixed origin, no redirects and no retry; upstream key echoes never reach the model', async () => {
  const plan = broker.requestPlan(
    { connectionId: connection.id, api: 'crm', action: 'contacts' },
    connection
  );
  let calls = 0;
  await assert.rejects(
    broker.call(plan, key, async (url, opts) => {
      calls++;
      assert.equal(new URL(url).origin, broker.ORIGIN);
      assert.equal(opts.redirect, 'error');
      assert.equal(opts.headers.authorization, `Bearer ${key}`);
      return new Response(JSON.stringify({ leak: key }));
    })
  );
  assert.equal(calls, 1);
  await assert.rejects(
    broker.call({ ...plan, url: 'https://attacker.invalid' }, key, () => {
      throw new Error('must not fetch');
    })
  );
});
test('verify gets project identity from BMT, not the user label', async () => {
  const v = await broker.verify(
    key,
    async () =>
      new Response(
        JSON.stringify({ your_access: { project_id: connection.project_id, scopes: ['crm:read'] } })
      )
  );
  assert.equal(v.projectId, connection.project_id);
  await assert.rejects(
    broker.verify(
      key,
      async () => new Response('{"your_access":{"project_id":"wrong","scopes":[]}}')
    )
  );
});
test('subscription Claude BMT protocol retains no native tools, MCP or Mac access', () => {
  const args = claudeArguments({ sessionId: crypto.randomUUID(), resume: false, bmt: true });
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.ok(args.includes('--safe-mode'));
  assert.ok(args.includes('--restricted'));
  assert.ok(!args.includes('--bare'));
});
test('planner only proposes mutations, labels source and limits the model loop', async () => {
  const pair = broker.keys();
  const c = { ...connection, envelope: sealed(pair) };
  let models = 0,
    fetches = 0;
  const calls = [];
  const claim = {
    job: { id: crypto.randomUUID(), input: 'Proposer une fiche' },
    chat: { id: crypto.randomUUID() },
    connections: [c],
    history: [],
    actions: [],
    outputs: [],
  };
  const answer = await planAgent({
    claim,
    agent: { id: c.agent_id },
    pair,
    stateDir: '/fixture',
    api: async (op, data) => {
      calls.push({ op, data });
      return op === 'access' ? c : { approvalId: data.id, status: 'pending' };
    },
    openRuntime: async () => ({
      close() {},
      journal: {
        acknowledge() {},
        async run() {
          models++;
          return {
            output: JSON.stringify(
              models === 1
                ? {
                    type: 'request',
                    command: {
                      connectionId: c.id,
                      api: 'crm',
                      action: 'contacts',
                      method: 'POST',
                      body: { name: 'Fixture' },
                    },
                  }
                : { type: 'answer', text: 'Proposition en attente de ton accord.' }
            ),
          };
        },
      },
    }),
    fetchImpl: async () => {
      fetches++;
    },
  });
  assert.equal(fetches, 0);
  assert.equal(calls.filter((x) => x.op === 'propose').length, 1);
  assert.equal(answer.sources[0].projectId, c.project_id);
  assert.equal(models, 2);
});
test('cross-agent project requests never obtain another agent key', async () => {
  const claim = {
    job: { id: crypto.randomUUID(), input: 'fixture' },
    chat: { id: crypto.randomUUID() },
    connections: [],
    history: [],
    actions: [],
    outputs: [],
  };
  let fetches = 0,
    models = 0;
  await planAgent({
    claim,
    agent: { id: crypto.randomUUID() },
    pair: broker.keys(),
    stateDir: '/fixture',
    api: async () => {
      throw new Error('scope denied');
    },
    openRuntime: async () => ({
      close() {},
      journal: {
        acknowledge() {},
        async run() {
          models++;
          return {
            output: JSON.stringify(
              models === 1
                ? {
                    type: 'request',
                    command: { connectionId: connection.id, api: 'crm', action: 'contacts' },
                  }
                : { type: 'answer', text: 'Refusé' }
            ),
          };
        },
      },
    }),
    fetchImpl: async () => {
      fetches++;
    },
  });
  assert.equal(fetches, 0);
});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bmt-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('completed local run outbox replays delivery with zero generation', async (t) => {
  const stateDir = fixture(t),
    id = crypto.randomUUID();
  writeDurableJson(path.join(stateDir, `run-${id}.json`), {
    status: 'completed',
    result: { answers: [] },
  });
  let models = 0;
  const calls = [];
  const result = await runBmtTick({
    stateDir,
    machine: async ({ op, data }) => {
      calls.push({ op, data });
      if (op === 'pending') {
        return { connections: [] };
      }
      if (op === 'action-claim') {
        return { action: null };
      }
      if (op === 'claim') {
        return { job: { id } };
      }
      return { ok: true };
    },
    openRuntime: () => {
      models++;
    },
  });
  assert.equal(result.status, 'replayed-delivery');
  assert.equal(models, 0);
  assert.equal(calls.at(-1).op, 'finish');
});
test('interrupted write is marked uncertain and never sent a second time', async (t) => {
  const stateDir = fixture(t),
    id = crypto.randomUUID();
  writeDurableJson(path.join(stateDir, `action-${id}.json`), { status: 'started' });
  let fetches = 0;
  const calls = [];
  await runBmtTick({
    stateDir,
    machine: async ({ op, data }) => {
      calls.push({ op, data });
      if (op === 'pending') {
        return { connections: [] };
      }
      if (op === 'action-claim') {
        return { reconcile: id };
      }
      return { ok: true };
    },
    fetchImpl: () => {
      fetches++;
    },
  });
  assert.equal(fetches, 0);
  assert.equal(calls.at(-1).data.uncertain, true);
});
test('worker lock prevents even enrollment key rotation or queue polling', async (t) => {
  const stateDir = fixture(t);
  fs.writeFileSync(path.join(stateDir, 'worker.lock'), 'fixture', { mode: 0o600 });
  let calls = 0;
  assert.equal(
    (
      await runBmtTick({
        stateDir,
        machine: () => {
          calls++;
        },
      })
    ).status,
    'locked'
  );
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(path.join(stateDir, 'enrollment-key.json')), false);
});
test('durable step identity binds job, agent and step', () => {
  const run = crypto.randomUUID(),
    agent = crypto.randomUUID();
  assert.equal(stepId(run, agent, 1), stepId(run, agent, 1));
  assert.notEqual(stepId(run, agent, 1), stepId(run, agent, 2));
  assert.notEqual(stepId(run, agent, 1), stepId(run, crypto.randomUUID(), 1));
  assert.match(stepId(run, agent, 1), broker.UUID);
});
