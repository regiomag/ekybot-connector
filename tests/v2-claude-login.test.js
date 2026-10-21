const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  validateAuthorizeUrl,
  loginEnvironment,
  readClaudeStatus,
  loginClaude,
} = require('../src/v2-claude-login');
const url = () =>
  new URL(
    'https://claude.com/cai/oauth/authorize?client_id=fixture&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A12345%2Fcallback&state=fixture&code_challenge=fixture&code_challenge_method=S256'
  );
function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ekybot-auth-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('only original native authorization URLs with a local callback are allowed', () => {
  assert.equal(validateAuthorizeUrl(url().href), url().href);
  for (const [key, value] of [
    ['redirect_uri', 'https://evil.invalid'],
    ['redirect_uri', 'http://localhost.evil.invalid:1/callback'],
    ['access_token', 'synthetic'],
    ['code_challenge_method', 'plain'],
  ]) {
    const u = url();
    u.searchParams.set(key, value);
    assert.throws(() => validateAuthorizeUrl(u.href));
  }
  const u = url();
  u.hostname = 'evil.invalid';
  assert.throws(() => validateAuthorizeUrl(u.href));
});
test('CLI environment excludes all inherited credentials and provider overrides', () => {
  assert.deepEqual(Object.keys(loginEnvironment('/fixture')).sort(), ['HOME', 'LANG', 'PATH']);
});
test('native auth status is verified independently from process exit and does not expose identity', async () => {
  let i = 0;
  const run = async () => ({
    stdout:
      ++i === 1
        ? '2.1.285 (Claude Code)'
        : JSON.stringify({
            loggedIn: true,
            authMethod: 'claude.ai',
            email: 'not-returned@example.invalid',
          }),
  });
  assert.deepEqual(await readClaudeStatus('/fixture', run), { connected: true, otherAuth: false });
  await assert.rejects(
    readClaudeStatus('/fixture', async () => ({ stdout: 'unqualified version' }))
  );
});
test('existing API credentials are not replaced with a subscription login', async (t) => {
  let starts = 0;
  const result = await loginClaude({
    home: '/fixture',
    directory: directory(t),
    status: async () => ({ connected: false, otherAuth: true }),
    spawnImpl: () => {
      starts++;
    },
  });
  assert.equal(result.reason, 'different_auth_method');
  assert.equal(starts, 0);
});
test('the official CLI receives no pasted credential; browser callback determines success', async (t) => {
  const root = directory(t);
  let checks = 0,
    child,
    received;
  const result = await loginClaude({
    home: '/fixture',
    directory: root,
    status: async () => ({ connected: ++checks === 2 }),
    onAuthorize: async (value) => {
      received = value;
      child.exitCode = 0;
      child.emit('exit', 0);
    },
    spawnImpl: (binary, args, options) => {
      assert.equal(binary, '/opt/homebrew/bin/claude');
      assert.deepEqual(args, ['auth', 'login', '--claudeai']);
      child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => {};
      child.exitCode = null;
      child.signalCode = null;
      setImmediate(() => {
        const tmp = options.env.EKYBOT_AUTH_URL_FILE + '.pending';
        fs.writeFileSync(tmp, url().href, { mode: 0o600 });
        fs.renameSync(tmp, options.env.EKYBOT_AUTH_URL_FILE);
      });
      return child;
    },
  });
  assert.deepEqual(result, { status: 'authenticated', reason: null });
  assert.equal(received, url().href);
  assert.equal(child.stdin.readableLength, 0);
  assert.equal(fs.existsSync(path.join(root, 'authorize-url')), false);
});
test('bounded authentication expiry does not claim success or launch a model', async (t) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let kills = 0;
  child.kill = () => {
    kills++;
  };
  child.exitCode = null;
  child.signalCode = 'SIGTERM';
  const result = await loginClaude({
    home: '/fixture',
    directory: directory(t),
    ttlMs: 10,
    status: async () => ({ connected: false }),
    spawnImpl: () => child,
    onAuthorize: async () => {},
  });
  assert.equal(result.status, 'expired');
  assert.equal(kills, 1);
});
