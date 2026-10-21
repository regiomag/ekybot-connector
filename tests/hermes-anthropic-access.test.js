const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFreshProfile } = require('../src/hermes-fresh-profile');
const {
  installAnthropicKey,
  selectAnthropicWorkspace,
  readAnthropicCredential,
} = require('../src/hermes-pilot-profile');
const { checkAnthropicAccess } = require('../src/hermes-anthropic-access');
const key = 'sk-ant-usr-synthetic-key-for-tests-only-123456';
const workspace = 'wrkspc_syntheticworkspace12345';
function fixture(t) {
  const directory = fs.mkdtempSync('/private/tmp/ekybot-anthropic-check.');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = { root: path.join(directory, 'hermes') };
  createFreshProfile(options);
  installAnthropicKey(key, options);
  return options;
}
test('workspace selection is explicit, private, idempotent and does not change the key', (t) => {
  const options = fixture(t);
  selectAnthropicWorkspace(workspace, options);
  selectAnthropicWorkspace(workspace, options);
  assert.equal(readAnthropicCredential(options).apiKey, key);
  assert.equal(readAnthropicCredential(options).workspaceId, workspace);
  assert.throws(() => selectAnthropicWorkspace('wrkspc_anotherworkspace12345', options));
  assert.throws(() => selectAnthropicWorkspace('wrkspc_foo\nInjected: header', options));
});
test('metadata request carries workspace and secret only via stdin, with no retries or generation', (t) => {
  const options = fixture(t);
  selectAnthropicWorkspace(workspace, options);
  let calls = 0;
  const report = checkAnthropicAccess({
    options,
    invoke: (file, args, spec) => {
      calls++;
      assert.equal(file, '/usr/bin/curl');
      assert.ok(!args.join(' ').includes(key));
      assert.equal(args.at(-1), 'https://api.anthropic.com/v1/models/claude-opus-5-5');
      assert.ok(!args.includes('--retry') && !args.includes('--location'));
      assert.ok(spec.input.includes(`anthropic-workspace-id: ${workspace}`));
      assert.ok(spec.input.includes(key));
      return { status: 0, stdout: '{"type":"model","id":"claude-opus-5-5"}\n200' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.status, 'model-metadata-verified');
  assert.equal(report.modelInvoked, false);
  assert.ok(!JSON.stringify(report).includes(key));
});
test('failure reports classify workspace needs without exposing upstream secrets', (t) => {
  const options = fixture(t);
  const cases = [
    [
      400,
      `This API key is not scoped; include anthropic-workspace-id. ${key}`,
      'workspace-required',
    ],
    [401, key, 'authentication-rejected'],
    [403, key, 'permission-denied'],
    [404, key, 'model-or-workspace-unavailable'],
    [502, key, 'metadata-unverified'],
  ];
  for (const [code, message, status] of cases) {
    const report = checkAnthropicAccess({
      options,
      invoke: () => ({ status: 0, stdout: `${JSON.stringify({ error: { message } })}\n${code}` }),
    });
    assert.equal(report.status, status);
    assert.ok(!JSON.stringify(report).includes(key));
  }
  const report = checkAnthropicAccess({ options, invoke: () => ({ status: 28, stderr: key }) });
  assert.equal(report.status, 'network-unavailable');
  assert.ok(!JSON.stringify(report).includes(key));
});
