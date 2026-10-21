const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPilotRouting } = require('../src/hermes-pilot-routing');

test('pilot uses only Claude API after cancellation of OpenAI enrollment', () => {
  const plan = buildPilotRouting();
  assert.deepEqual(plan.config.model, { provider: 'anthropic', default: 'claude-opus-5-5' });
  assert.deepEqual(plan.config.fallback_providers, []);
  assert.equal(plan.config.agent.reasoning_effort, 'medium');
  assert.equal(plan.activationRequired, true);
  assert.equal(plan.fallback, null);
  assert.equal(plan.primary.metered, true);
  assert.equal(plan.primary.authentication, 'api-key');
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
  first.config.fallback_providers.push({ provider: 'other', model: 'other' });
  const second = buildPilotRouting({ reasoningEffort: 'max' });
  assert.deepEqual(second.config.fallback_providers, []);
});

test('routing rejects unsupported reasoning settings', () => {
  for (const reasoningEffort of ['auto', 'ultra', 'none']) {
    assert.throws(() => buildPilotRouting({ reasoningEffort }), {
      code: 'PILOT_REASONING_REQUIRED',
    });
  }
});
