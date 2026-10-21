const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPilotRouting } = require('../src/hermes-pilot-routing');

test('pilot keeps the requested exact models and different billing routes', () => {
  const plan = buildPilotRouting({ reasoningEffort: 'max' });
  assert.deepEqual(plan.config.model, { provider: 'openai-codex', default: 'gpt-5.6-sol' });
  assert.deepEqual(plan.config.fallback_providers, [
    {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      key_env: 'ANTHROPIC_API_KEY',
    },
  ]);
  assert.equal(plan.config.agent.reasoning_effort, 'max');
  assert.equal(plan.activationRequired, true);
  assert.equal(plan.fallback.metered, true);
  assert.equal(plan.primary.authentication, 'independent-chatgpt-login');
});

test('routing retains the fresh profile restrictions and never grants tools', () => {
  const { config } = buildPilotRouting({ reasoningEffort: 'medium' });
  assert.deepEqual(config.toolsets, []);
  assert.deepEqual(config.platform_toolsets.cli, []);
  assert.deepEqual(config.mcp_servers, {});
  assert.deepEqual(config.skills.external_dirs, []);
  assert.equal(config.skills.project_discovery, false);
  assert.deepEqual(config.providers, {});
  assert.equal(JSON.stringify(config).includes('api_key'), false);
});

test('routing has no shared mutable provider chain', () => {
  const first = buildPilotRouting({ reasoningEffort: 'max' });
  first.config.fallback_providers[0].model = 'other';
  const second = buildPilotRouting({ reasoningEffort: 'max' });
  assert.equal(second.config.fallback_providers[0].model, 'claude-opus-5-5');
});

test('routing requires an explicit supported reasoning setting', () => {
  for (const reasoningEffort of [undefined, 'auto', 'ultra', 'none']) {
    assert.throws(() => buildPilotRouting({ reasoningEffort }), {
      code: 'PILOT_REASONING_REQUIRED',
    });
  }
});
