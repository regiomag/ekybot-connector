const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { developmentBmt } = require('../src/development-bmt');
const { DevelopmentBroker } = require('../src/development-broker');
const api = require('../src/bmt-broker');
const key = 'bmt_synthetic_fixture_not_real_123456789';
const pair = api.keys();
function fixture({ approve = async () => true, uncertain = false } = {}) {
  const c = {
    id: crypto.randomUUID(),
    owner_id: crypto.randomUUID(),
    agent_id: crypto.randomUUID(),
    project_id: crypto.randomUUID(),
    label: 'Synthetic company',
    status: 'ready',
    scopes: ['crm:read', 'crm:write'],
  };
  const identity = [c.owner_id, c.agent_id, c.id],
    aes = crypto.randomBytes(32),
    iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', aes, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(identity)));
  const sealed = Buffer.concat([cipher.update(key), cipher.final(), cipher.getAuthTag()]);
  c.envelope = {
    version: 1,
    keyId: pair.keyId,
    identity,
    iv: iv.toString('base64'),
    ciphertext: sealed.toString('base64'),
    wrapped: crypto
      .publicEncrypt(
        { key: crypto.createPublicKey({ key: pair.publicKey, format: 'jwk' }), oaepHash: 'sha256' },
        aes
      )
      .toString('base64'),
  };
  const calls = [];
  let revoked = false;
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.endsWith('/describe')) {
      return new Response(
        JSON.stringify({
          your_access: { project_id: c.project_id, scopes: revoked ? [] : c.scopes },
        })
      );
    }
    if (uncertain && options.method === 'POST') {
      throw new Error('Lost HTTP reply');
    }
    return new Response(JSON.stringify({ fixture: true }));
  };
  const metadata = {
    id: c.id,
    owner_id: c.owner_id,
    agent_id: c.agent_id,
    project_id: c.project_id,
    label: c.label,
    status: c.status,
    scopes: c.scopes,
  };
  const extension = developmentBmt({
    connections: [metadata],
    access: async (id) => {
      assert.equal(id, c.id);
      return c;
    },
    pair,
    fetchImpl,
  });
  const root = fs.mkdtempSync('/private/tmp/ekydev-bmt-');
  const broker = new DevelopmentBroker({
    ...extension,
    root,
    stateDir: path.join(root, 'state'),
    runId: crypto.randomUUID(),
    role: 'developer',
    projects: [],
    grants: { write: false, git: false, exec: false },
    approve: async (request) =>
      approve(request, () => {
        revoked = true;
      }),
  });
  return { c, broker, extension, calls, root };
}
test('combined project broker reads only selected BMT data, without any key in model context', async () => {
  const f = fixture({
    approve: () => {
      throw new Error('Reads do not ask mutation approval');
    },
  });
  await f.extension.assertAccess();
  assert.equal(f.extension.instructions.includes(key), false);
  const result = await f.broker.call('ekybot_bmt_request', {
    connectionId: f.c.id,
    api: 'crm',
    action: 'contacts',
    method: 'GET',
  });
  assert.equal(result.source.projectId, f.c.project_id);
  assert.equal(result.result.ok, true);
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(
    f.broker.definitions().some((t) => t.name === 'ekybot_edit'),
    false
  );
});
test('unselected BMT connection is refused before any business request', async () => {
  const f = fixture();
  const result = await f.broker.call('ekybot_bmt_request', {
    connectionId: crypto.randomUUID(),
    api: 'crm',
    action: 'contacts',
  });
  assert.ok(result.error);
  assert.equal(f.calls.length, 0);
});
test('revoked external BMT scopes are checked again after exact mutation approval', async () => {
  const f = fixture({
    approve: async (request, revoke) => {
      assert.equal(request.input.effect, 'draft_create');
      assert.equal(JSON.stringify(request).includes(key), false);
      revoke();
      return true;
    },
  });
  const result = await f.broker.call('ekybot_bmt_request', {
    connectionId: f.c.id,
    api: 'crm',
    action: 'contacts',
    method: 'POST',
    body: { first_name: 'Synthetic' },
  });
  assert.ok(result.error);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
});
test('lost BMT mutation reply persists uncertainty and never repeats the effect', async () => {
  const f = fixture({ uncertain: true });
  const input = {
    connectionId: f.c.id,
    api: 'crm',
    action: 'contacts',
    method: 'POST',
    body: { first_name: 'Synthetic' },
  };
  const result = await f.broker.call('ekybot_bmt_request', input, 'fixed-call');
  assert.ok(result.error);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
  await assert.rejects(f.broker.call('ekybot_bmt_request', input, 'fixed-call'), /uncertain/);
  await assert.rejects(f.broker.call('ekybot_bmt_request', input, 'new-call'), /uncertain/);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
});
test('unknown BMT operations and caller-supplied URLs cannot bypass the shared registry', async () => {
  const f = fixture();
  await assert.rejects(
    f.broker.call('ekybot_bmt_request', {
      connectionId: f.c.id,
      api: 'crm',
      action: 'contacts',
      url: 'https://invalid.example',
    }),
    /arguments/
  );
  const result = await f.broker.call('ekybot_bmt_request', {
    connectionId: f.c.id,
    api: 'crm',
    action: 'unknown',
  });
  assert.ok(result.error);
  assert.equal(f.calls.filter((c) => !c.url.endsWith('/describe')).length, 0);
});
