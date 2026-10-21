const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startKeySetup } = require('../src/hermes-pilot-key-setup');
test('local key form rejects foreign origins and invalid nonces, then closes after one save', async (t) => {
  const keys = [];
  const setup = await startKeySetup({
    install: (key) => {
      keys.push(key);
      return { status: 'api-key-installed' };
    },
  });
  t.after(setup.close);
  const form = await fetch(setup.url);
  const html = await form.text();
  assert.equal(form.headers.get('cache-control'), 'no-store');
  assert.equal(form.headers.get('referrer-policy'), 'same-origin');
  assert.match(form.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.ok(html.includes('type="password"'));
  assert.ok(!html.includes('<script'));
  const url = new URL(setup.url);
  const nonce = url.pathname.split('/').pop();
  const key = 'sk-ant-usr-synthetic-key-for-tests-only-123456';
  const send = (origin, token) =>
    fetch(`${url.origin}/key`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ nonce: token, apiKey: key }).toString(),
    });
  assert.equal((await send('https://evil.example', nonce)).status, 403);
  assert.equal((await send('null', nonce)).status, 403);
  assert.equal((await send(url.origin, 'invalid')).status, 403);
  assert.deepEqual(keys, []);
  const response = await send(url.origin, nonce);
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes(key));
  assert.deepEqual(keys, [key]);
  assert.deepEqual(await setup.completion, { status: 'api-key-installed' });
});
test('local key form requires Origin even when a valid nonce is submitted', async (t) => {
  let calls = 0;
  const setup = await startKeySetup({
    install: () => {
      calls++;
    },
  });
  t.after(setup.close);
  const url = new URL(setup.url);
  const response = await fetch(`${url.origin}/key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      nonce: url.pathname.split('/').pop(),
      apiKey: 'sk-ant-api03-synthetic-key-for-tests-only-123456',
    }).toString(),
  });
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});
test('local key form refuses OAuth tokens without writing', async (t) => {
  let calls = 0;
  const setup = await startKeySetup({
    install: () => {
      calls++;
    },
  });
  t.after(setup.close);
  const url = new URL(setup.url);
  const response = await fetch(`${url.origin}/key`, {
    method: 'POST',
    headers: { Origin: url.origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      nonce: url.pathname.split('/').pop(),
      apiKey: 'sk-ant-oat-not-an-api-key',
    }).toString(),
  });
  assert.equal(response.status, 400);
  const html = await response.text();
  assert.match(html, /role="alert"/);
  assert.match(html, /jeton de connexion Claude/);
  assert.match(html, /<form method="post" action="\/key"/);
  assert.ok(!html.includes('sk-ant-oat-not-an-api-key'));
  assert.equal(calls, 0);
});

test('input guidance never reflects rejected values and permits correction with the same nonce', async (t) => {
  let calls = 0;
  const setup = await startKeySetup({
    install: () => ({ calls: ++calls }),
  });
  t.after(setup.close);
  const url = new URL(setup.url);
  const send = (apiKey) =>
    fetch(`${url.origin}/key`, {
      method: 'POST',
      headers: { Origin: url.origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ nonce: url.pathname.split('/').pop(), apiKey }),
    });
  for (const [value, hint] of [
    ['sk-or-synthetic-only', /clé OpenRouter/],
    ['sk-ant-api03-…masked…', /masquée ou tronquée/],
    ['<script>synthetic</script>', /Format non reconnu localement/],
  ]) {
    const response = await send(value);
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, hint);
    assert.ok(!html.includes(value));
  }
  assert.equal(calls, 0);
  assert.equal((await send('sk-ant-api03-synthetic-key-for-tests-only-123456')).status, 200);
  assert.deepEqual(await setup.completion, { calls: 1 });
});
