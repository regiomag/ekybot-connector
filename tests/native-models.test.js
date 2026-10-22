const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { normalizeModels, discoverModels } = require('../src/native-models');
const { telemetry } = require('../src/native-telemetry');
test('model catalog preserves actual CLI ids and excludes hidden entries', () => {
  assert.deepEqual(
    normalizeModels(
      [
        { model: 'qualified-model', displayName: 'Qualified', isDefault: true },
        { hidden: true, model: 'hidden' },
      ],
      'codex'
    ),
    [{ id: 'qualified-model', label: 'Qualified', resolved: 'qualified-model', isDefault: true }]
  );
  assert.equal(
    normalizeModels(
      [
        {
          value: 'claude-fixture[1m]',
          resolvedModel: 'claude-fixture',
          displayName: 'Long context',
        },
      ],
      'claude'
    )[0].id,
    'claude-fixture[1m]'
  );
  assert.throws(() =>
    normalizeModels([{ model: 'https://wrong.example', displayName: 'Bad' }], 'codex')
  );
  assert.throws(() =>
    normalizeModels(
      [
        { model: 'a', displayName: 'a' },
        { model: 'a', displayName: 'b' },
      ],
      'codex'
    )
  );
});
test('catalog discovery caches metadata only; a disconnected provider stays unavailable', async (t) => {
  const stateDir = fs.mkdtempSync('/private/tmp/model-test.');
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  let calls = 0;
  const discover = {
    codex: async () => {
      calls++;
      return [{ id: 'fixture', label: 'Fixture', resolved: 'fixture', isDefault: true }];
    },
    claude: async () => {
      throw new Error('private diagnostic');
    },
  };
  const first = await discoverModels({ stateDir, home: '/fixture', discover });
  const cached = await discoverModels({ stateDir, home: '/fixture', discover });
  assert.deepEqual(first, cached);
  assert.equal(calls, 1);
  assert.equal(first.entries[1].status, 'unavailable');
  assert.ok(!JSON.stringify(first).includes('private diagnostic'));
});
test('usage keeps absent counters unknown and drops all payloads and credentials', () => {
  const result = telemetry({
    model: 'fixture',
    inputTokens: 42,
    outputTokens: -1,
    cachedInputTokens: '123',
    contextTokens: Infinity,
    text: 'private',
    apiKey: 'secret',
  });
  assert.equal(result.inputTokens, 42);
  assert.equal(result.outputTokens, null);
  assert.equal(result.contextWindow, null);
  assert.equal(result.cachedInputTokens, null);
  assert.equal(result.contextTokens, null);
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.ok(!Object.hasOwn(result, 'text'));
});
