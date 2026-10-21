const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFreshProfile } = require('../src/hermes-fresh-profile');
const { installAnthropicKey, selectAnthropicWorkspace } = require('../src/hermes-pilot-profile');
const { writeDurableJson } = require('../src/hermes-resume-guard');
const {
  activatePilot,
  readActivation,
  createPilotJournal,
} = require('../src/hermes-pilot-executor');

test('activation is explicit, private, pinned and cannot reset history', (t) => {
  const directory = fs.mkdtempSync('/private/tmp/ekybot-activation-test.');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = { root: path.join(directory, 'hermes') };
  const plan = createFreshProfile(options);
  assert.throws(() => readActivation(options));
  installAnthropicKey('sk-ant-usr-synthetic-key-for-tests-only-123456', options);
  selectAnthropicWorkspace('wrkspc_fixture12345', options);
  writeDurableJson(path.join(plan.home, 'auth.json'), {
    providers: {
      'openai-codex': {
        auth_mode: 'chatgpt',
        tokens: { access_token: 'FIXTURE', refresh_token: 'FIXTURE' },
      },
    },
  });
  const runtime = path.join(directory, 'runtime');
  for (const name of [
    'run_agent.py',
    'hermes_state.py',
    'hermes_constants.py',
    'agent/agent_init.py',
    'agent/conversation_loop.py',
    'agent/chat_completion_helpers.py',
    'agent/anthropic_adapter.py',
    'agent/anthropic_credentials.py',
    'agent/codex_runtime.py',
    'hermes_cli/auth.py',
  ]) {
    fs.mkdirSync(path.dirname(path.join(runtime, name)), { recursive: true });
    fs.writeFileSync(path.join(runtime, name), '# inert fixture');
  }
  const args = {
    ...options,
    runtime,
    python: '/fixture/python',
    packages: '/fixture/packages',
    channelId: '11111111-1111-4111-8111-111111111111',
  };
  assert.equal(activatePilot(args).modelInvoked, false);
  assert.throws(() => activatePilot(args));
  assert.equal(readActivation(options).active.executionAllowed, true);
  assert.equal(createPilotJournal(options).binding(), null);
  assert.equal(fs.existsSync(path.join(plan.home, 'state.db')), false);
  assert.equal(fs.statSync(path.join(plan.home, '.ekybot-pilot-active.json')).mode & 0o777, 0o600);
  fs.appendFileSync(path.join(runtime, 'run_agent.py'), '\n# changed');
  assert.throws(() => readActivation(options));
});
