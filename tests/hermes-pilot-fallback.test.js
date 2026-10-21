const { test } = require('node:test');
const assert = require('node:assert/strict');
const { choosePilotFallback } = require('../src/hermes-pilot-fallback');
const { buildPilotRouting } = require('../src/hermes-pilot-routing');

const rejected = {
  provider: 'openai-codex',
  disposition: 'rejected-before-execution',
  attempt: 1,
  outputReceived: false,
  toolsExecuted: false,
  code: 'rate_limited',
  httpStatus: 429,
};

test('explicit OpenAI priority preserves exact 5.6 family, subscription and Claude API fallback', () => {
  const route = buildPilotRouting({ routingMode: 'openai-primary' });
  assert.equal(route.primary.model, 'gpt-5.6-sol');
  assert.equal(route.primary.authentication, 'chatgpt-subscription');
  assert.equal(route.fallback.model, 'claude-opus-5-5');
  assert.equal(route.fallback.authentication, 'api-key');
  assert.deepEqual(route.config.fallback_providers, []);
  assert.equal(route.fallbackPolicy, 'verified-rejection-only');
  assert.equal(route.activationRequired, true);
  assert.throws(() => buildPilotRouting({ routingMode: 'automatic' }), {
    code: 'PILOT_ROUTING_INVALID',
  });
});

test('verified provider rejection permits at most one Claude attempt preserving the session', () => {
  const decision = choosePilotFallback(rejected);
  assert.equal(decision.action, 'fallback');
  assert.equal(decision.target.model, 'claude-opus-5-5');
  assert.equal(decision.maxAttempts, 1);
  assert.equal(decision.preserveSession, true);
});

test('timeout, partial output, tool execution, malformed evidence and second failures never auto-fallback', () => {
  for (const change of [
    { disposition: 'unknown' },
    { disposition: undefined },
    { code: 'timeout' },
    { httpStatus: 500 },
    { outputReceived: true },
    { outputReceived: undefined },
    { toolsExecuted: true },
    { attempt: 2 },
    { provider: 'anthropic' },
    { code: 'toString' },
  ]) {
    assert.equal(choosePilotFallback({ ...rejected, ...change }).action, 'stop');
  }
  assert.equal(choosePilotFallback(null).action, 'stop');
});
