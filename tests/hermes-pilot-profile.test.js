const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createFreshProfile, PREPARED_MARKER } = require('../src/hermes-fresh-profile');
const { writeDurableJson } = require('../src/hermes-resume-guard');
const {
  configurePilotProfile,
  importAnthropicKey,
  installAnthropicKey,
  isAnthropicApiKey,
  KEY_FILE,
  selectAnthropicWorkspace,
} = require('../src/hermes-pilot-profile');

test('OpenAI priority requires independent authentication and preserves the Claude key and fresh memory', (t) => {
  const { options, profile } = fixture(t);
  const key = 'sk-ant-usr-synthetic-key-for-tests-only-123456';
  installAnthropicKey(key, options);
  selectAnthropicWorkspace('wrkspc_fixture12345', options);
  const keyBefore = fs.readFileSync(path.join(profile.home, KEY_FILE), 'utf8');
  assert.throws(() => configurePilotProfile({ ...options, routingMode: 'openai-primary' }));
  writeDurableJson(path.join(profile.home, 'auth.json'), {
    providers: {
      'openai-codex': {
        auth_mode: 'chatgpt',
        tokens: { access_token: 'FAKE_ACCESS', refresh_token: 'FAKE_REFRESH' },
      },
    },
  });
  for (let i = 0; i < 2; i++) {
    const result = configurePilotProfile({ ...options, routingMode: 'openai-primary' });
    assert.equal(result.model, 'gpt-5.6-sol');
    assert.equal(result.provider, 'openai-codex');
    assert.equal(result.fallback.model, 'claude-opus-5-5');
    assert.equal(result.executionAllowed, false);
  }
  assert.equal(fs.readFileSync(path.join(profile.home, KEY_FILE), 'utf8'), keyBefore);
  assert.equal(fs.statSync(path.join(profile.home, 'memories/MEMORY.md')).size, 0);
  const policy = JSON.parse(
    fs.readFileSync(path.join(profile.home, '.ekybot-provider-policy.json'))
  );
  assert.equal(policy.fallbackPolicy, 'verified-rejection-only');
  assert.equal(policy.executionAllowed, false);
  assert.equal(JSON.stringify(policy).includes('FAKE_ACCESS'), false);
  assert.throws(() => configurePilotProfile(options));
});
function fixture(t) {
  const directory = fs.mkdtempSync('/private/tmp/ekybot-pilot-config.');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = { root: path.join(directory, 'hermes') };
  const profile = createFreshProfile(options);
  return { directory, options, profile };
}
test('Claude configuration leaves the execution quarantine and empty memory intact', (t) => {
  const { options, profile } = fixture(t);
  for (let i = 0; i < 2; i++) {
    assert.equal(configurePilotProfile(options).executionAllowed, false);
  }
  const config = JSON.parse(fs.readFileSync(path.join(profile.home, 'config.yaml')));
  assert.equal(config.model.default, 'claude-opus-5-5');
  assert.deepEqual(config.fallback_providers, []);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(profile.home, PREPARED_MARKER))).executionAllowed,
    false
  );
  assert.equal(fs.statSync(path.join(profile.home, 'memories/MEMORY.md')).size, 0);
});
test('personal Console keys are stored without imposing the legacy API prefix', (t) => {
  const { options, profile } = fixture(t);
  const key = 'sk-ant-usr-synthetic-key-for-tests-only-123456';
  assert.equal(installAnthropicKey(key, options).status, 'api-key-installed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile.home, KEY_FILE))).apiKey, key);
});
test('syntax screening allows Console key families but rejects OAuth, admin and masked input', () => {
  for (const kind of ['api03', 'usr', 'svc']) {
    assert.equal(isAnthropicApiKey(`sk-ant-${kind}-synthetic-key-for-tests-only-123456`), true);
  }
  for (const key of [
    'sk-ant-oat01-synthetic-key-for-tests-only-123456',
    'sk-ant-ort01-synthetic-key-for-tests-only-123456',
    'sk-ant-admin01-synthetic-key-for-tests-only-123456',
    'sk-or-v1-synthetic-key-for-tests-only-123456',
    'sk-ant-usr-masked…',
    'sk-ant-usr-contains a space-synthetic-123456',
    null,
  ]) {
    assert.equal(isAnthropicApiKey(key), false);
  }
});
test('only the explicitly approved Anthropic API key is copied privately', (t) => {
  const { directory, options, profile } = fixture(t);
  const source = path.join(directory, 'source.env');
  const key = 'sk-ant-api03-synthetic-key-for-tests-only-123456';
  fs.writeFileSync(source, `ANTHROPIC_API_KEY=${key}\nOTHER_SECRET=not-to-copy\n`);
  const result = importAnthropicKey(source, options);
  assert.ok(!JSON.stringify(result).includes(key));
  const target = path.join(profile.home, KEY_FILE);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(target)).apiKey, key);
  assert.ok(!fs.readFileSync(target, 'utf8').includes('not-to-copy'));
  assert.equal(fs.statSync(path.join(profile.home, '.env')).size, 0);
  assert.equal(importAnthropicKey(source, options).status, 'api-key-installed');
});
test('configuration refuses nonempty memory before writing anything', (t) => {
  const { options, profile } = fixture(t);
  fs.writeFileSync(path.join(profile.home, 'memories/MEMORY.md'), 'old memory');
  assert.throws(() => configurePilotProfile(options), { code: 'PILOT_CONFIGURATION_CONFLICT' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile.home, 'config.yaml'))).model, '');
});
test('OAuth tokens and missing API keys are not silently accepted', (t) => {
  const { directory, options, profile } = fixture(t);
  const source = path.join(directory, 'source.env');
  fs.writeFileSync(source, 'ANTHROPIC_API_KEY=sk-ant-oat-not-an-api-key');
  assert.throws(() => importAnthropicKey(source, options), /No Anthropic API key/);
  assert.equal(fs.existsSync(path.join(profile.home, KEY_FILE)), false);
});
