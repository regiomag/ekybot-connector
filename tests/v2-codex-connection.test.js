const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertChatOnlyConfig,
  disabledFeatures,
  openCodexChatConnection,
} = require('../src/v2-codex-connection');
const policy = () => ({
  approval_policy: 'never',
  sandbox_mode: 'read-only',
  web_search: 'disabled',
  project_doc_max_bytes: 0,
  features: {
    skip_host_skill_discovery: true,
    ...Object.fromEntries(disabledFeatures.map((key) => [key, false])),
  },
  mcp_servers: { existing: { enabled: false } },
});

test('Codex chat-only policy cannot inherit tools, hooks, memory, instructions or custom inference URLs', () => {
  assert.doesNotThrow(() => assertChatOnlyConfig(policy()));
  assert.doesNotThrow(() =>
    assertChatOnlyConfig({ ...policy(), chatgpt_base_url: 'https://chatgpt.com/backend-api' })
  );
  for (const patch of [
    { sandbox_mode: 'workspace-write' },
    { mcp_servers: { dangerous: {} } },
    { instructions: 'inherited instructions' },
    { notify: ['command'] },
    { openai_base_url: 'https://unexpected.invalid' },
    { chatgpt_base_url: 'https://chatgpt.com.attacker.invalid/backend-api' },
    { model_instructions_file: '/private/file' },
    { features: { ...policy().features, hooks: true } },
    { features: { ...policy().features, shell_tool: true } },
  ]) {
    assert.throws(() => assertChatOnlyConfig({ ...policy(), ...patch }));
  }
});

test('Codex launcher rejects an unqualified CLI version before opening native transport', async () => {
  let opened = false;
  await assert.rejects(
    openCodexChatConnection({
      cwd: '/private/tmp',
      home: '/fixture/home',
      versionCheck: () => 'codex-cli another',
      createRpc: () => {
        opened = true;
      },
    }),
    { code: 'CODEX_POLICY_UNQUALIFIED' }
  );
  assert.equal(opened, false);
});

test('Codex launcher scopes inherited MCPs without copying authentication or inheriting process secrets', async () => {
  const options = [];
  let closed = 0;
  const connection = await openCodexChatConnection({
    cwd: '/private/tmp',
    home: '/fixture/home',
    versionCheck: () => 'codex-cli 0.155.0',
    createRpc: (launch) => {
      options.push(launch);
      return {
        notify: () => {},
        close: () => {
          closed++;
        },
        request: async (method) => {
          if (method === 'config/read') {
            return { config: policy() };
          }
          if (method === 'account/read') {
            return { account: { type: 'chatgpt' } };
          }
          return {};
        },
      };
    },
  });
  assert.equal(closed, 1);
  assert.equal(options.length, 2);
  assert.ok(options[1].args.includes('mcp_servers.existing.enabled=false'));
  assert.deepEqual(Object.keys(options[1].env).sort(), ['HOME', 'LANG', 'PATH']);
  assert.equal(connection.capabilities.fileRead, false);
  connection.rpc.close();
});
