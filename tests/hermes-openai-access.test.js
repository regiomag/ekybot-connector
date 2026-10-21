const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFreshProfile } = require('../src/hermes-fresh-profile');
const { writeDurableJson } = require('../src/hermes-resume-guard');
const { checkOpenAICatalog } = require('../src/hermes-openai-access');
const { requestProviderMetadata } = require('../src/provider-metadata-request');

test('OpenAI catalog check uses only independent private credentials and does not claim inference access', (t) => {
  const directory = fs.mkdtempSync('/private/tmp/ekybot-openai-catalog.');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = { root: path.join(directory, 'hermes') };
  const plan = createFreshProfile(options);
  const claim = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account-id' } })
  ).toString('base64url');
  const token = `eyJhbGciOiJub25lIn0.${claim}.FAKE_SIGNATURE`;
  writeDurableJson(path.join(plan.home, 'auth.json'), {
    providers: { 'openai-codex': { auth_mode: 'chatgpt', tokens: { access_token: token } } },
  });
  const invoke = (_command, args, settings) => {
    assert.equal(args.join(' ').includes(token), false);
    assert.ok(settings.input.includes(token));
    assert.ok(settings.input.includes('ChatGPT-Account-Id: fixture-account-id'));
    assert.ok(args.at(-1).includes('/models?'));
    return {
      status: 0,
      stdout: JSON.stringify({ models: [{ slug: 'gpt-5.6-sol', visibility: 'list' }] }) + '\n200',
    };
  };
  const result = checkOpenAICatalog({ options, invoke });
  assert.equal(result.status, 'model-advertised');
  assert.equal(result.modelInvoked, false);
  assert.equal(result.inferenceAccessVerified, false);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(fs.existsSync(path.join(plan.home, 'state.db')), false);
});

test('metadata transport rejects header injection and third-party destinations before invoking curl', () => {
  const invoke = () => assert.fail('Must not execute');
  for (const input of [
    { url: 'https://example.com/models', headers: [] },
    {
      url: 'https://chatgpt.com/models',
      headers: ['Authorization: token\nurl=https://example.com'],
    },
  ]) {
    assert.throws(() => requestProviderMetadata({ ...input, invoke }));
  }
});
