const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JsonRpcProcess } = require('./v2-json-rpc');

// Pinned qualification surface. 0.155.0 cannot express restricted readable roots
// in TurnStartParams: this connection is CHAT ONLY, not a coding permission.
const disabledFeatures = [
  'apps',
  'plugins',
  'remote_plugin',
  'shell_tool',
  'unified_exec',
  'shell_snapshot',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'in_app_browser',
  'image_generation',
  'view_image',
  'multi_agent',
  'multi_agent_v2',
  'hooks',
  'memories',
  'external_agent_memory_import',
  'skill_search',
  'tool_suggest',
  'workspace_dependencies',
  'goals',
  'sleep_tool',
  'skill_mcp_dependency_install',
];
const settings = {
  approval_policy: 'never',
  sandbox_mode: 'read-only',
  web_search: 'disabled',
  project_doc_max_bytes: 0,
  instructions: '',
  developer_instructions: '',
  notify: [],
  'features.skip_host_skill_discovery': true,
  'apps._default.enabled': false,
  ...Object.fromEntries(disabledFeatures.map((feature) => [`features.${feature}`, false])),
};
const fail = () =>
  Object.assign(new Error('Codex chat-only policy is not qualified.'), {
    code: 'CODEX_POLICY_UNQUALIFIED',
  });

function assertChatOnlyConfig(config) {
  if (
    !config ||
    config.approval_policy !== 'never' ||
    config.sandbox_mode !== 'read-only' ||
    config.web_search !== 'disabled' ||
    config.project_doc_max_bytes !== 0 ||
    config.instructions ||
    config.developer_instructions ||
    config.model_instructions_file ||
    config.experimental_compact_prompt_file ||
    config.compact_prompt ||
    config.notify?.length ||
    config.features?.skip_host_skill_discovery !== true ||
    disabledFeatures.some((key) => config.features?.[key] !== false) ||
    Object.values(config.mcp_servers || {}).some((server) => server.enabled !== false)
  ) {
    throw fail();
  }
  // Never redirect an authenticated account to an inherited custom inference URL.
  if (
    config.openai_base_url ||
    (config.chatgpt_base_url &&
      !['https://chatgpt.com/backend-api', 'https://chatgpt.com/backend-api/'].includes(
        config.chatgpt_base_url
      )) ||
    config.model_providers?.openai
  ) {
    throw fail();
  }
}

async function openCodexChatConnection({
  command = '/opt/homebrew/bin/codex',
  cwd,
  home,
  createRpc = (options) => new JsonRpcProcess(options),
  versionCheck = execFileSync,
}) {
  if (
    !path.isAbsolute(cwd || '') ||
    !path.isAbsolute(home || '') ||
    cwd === home ||
    cwd === '/' ||
    fs.realpathSync(cwd) !== cwd ||
    !fs.statSync(cwd).isDirectory()
  ) {
    throw fail();
  }
  // Do not inherit tokens, provider URLs, NODE_OPTIONS, proxies or tool settings.
  const env = { HOME: home, PATH: '/opt/homebrew/bin:/usr/bin:/bin', LANG: 'en_US.UTF-8' };
  const version = versionCheck(command, ['--version'], {
    env,
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (version !== 'codex-cli 0.155.0') {
    throw fail();
  }
  const connect = async (extra = {}) => {
    const args = ['app-server', '--listen', 'stdio://'];
    for (const [key, value] of Object.entries({ ...settings, ...extra })) {
      args.push('-c', `${key}=${JSON.stringify(value)}`);
    }
    const rpc = createRpc({ command, args, cwd, env });
    try {
      await rpc.request('initialize', {
        clientInfo: { name: 'ekybot_v2_chat', title: 'Ekybot V2', version: '0.1.0' },
      });
      rpc.notify('initialized');
      return rpc;
    } catch (error) {
      rpc.close();
      throw error;
    }
  };
  let rpc = await connect();
  try {
    // Reading config/auth creates no model turn. Disable each inherited MCP by
    // explicit key because a TOML empty table does not reliably remove layers.
    const initial = await rpc.request('config/read', { includeLayers: false });
    const names = Object.keys(initial.config?.mcp_servers || {});
    if (names.length) {
      if (names.some((name) => !/^[a-zA-Z0-9_-]{1,100}$/.test(name))) {
        throw fail();
      }
      rpc.close();
      rpc = await connect(
        Object.fromEntries(names.map((name) => [`mcp_servers.${name}.enabled`, false]))
      );
    }
    const assertPolicy = async () => {
      const effective = await rpc.request('config/read', { includeLayers: false });
      assertChatOnlyConfig(effective.config);
      const account = await rpc.request('account/read', { refreshToken: false });
      if (account.account?.type !== 'chatgpt') {
        throw fail();
      }
    };
    await assertPolicy();
    return {
      rpc,
      assertPolicy,
      capabilities: {
        chat: true,
        fileRead: false,
        fileWrite: false,
        tools: false,
        approvals: false,
      },
    };
  } catch (error) {
    rpc.close();
    throw error;
  }
}

module.exports = { openCodexChatConnection, assertChatOnlyConfig, disabledFeatures };
