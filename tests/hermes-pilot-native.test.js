const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFreshProfile } = require('../src/hermes-fresh-profile');
const { buildPilotExecutionConfig } = require('../src/hermes-pilot-routing');
const { writeDurableJson } = require('../src/hermes-resume-guard');
const {
  inspectHermesSession,
  assertPersistedContinuation,
} = require('../src/hermes-session-safety');

for (const scenario of [
  { provider: 'anthropic' },
  { provider: 'openai-codex' },
  { provider: 'anthropic', webEnabled: true },
  { provider: 'openai-codex', webEnabled: true },
  { provider: 'openai-codex', fixturePrimaryStatus: 401, allowFallback: true },
  { provider: 'openai-codex', fixturePrimaryStatus: 500, allowFallback: true },
]) {
  const { provider, fixturePrimaryStatus } = scenario;
  test(
    `real native Hermes ${provider} ${scenario.webEnabled ? 'web' : ''} ${fixturePrimaryStatus || 'success'} persists safely without network or inherited context`,
    {
      skip:
        !process.env.EKYBOT_NATIVE_RUNTIME ||
        !process.env.EKYBOT_PROBE_PYTHON ||
        !process.env.EKYBOT_NATIVE_PACKAGES,
    },
    async (t) => {
      const directory = fs.mkdtempSync('/private/tmp/ekybot-native-fixture.');
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
      const options = { root: path.join(directory, 'hermes') };
      const plan = createFreshProfile(options);
      writeDurableJson(
        path.join(plan.home, 'config.yaml'),
        buildPilotExecutionConfig({
          ...options,
          routingMode: provider === 'openai-codex' ? 'openai-primary' : 'claude-only',
        })
      );
      const run = (sessionId) => {
        const child = spawnSync(
          process.env.EKYBOT_PROBE_PYTHON,
          ['-I', '-B', '-S', path.resolve('scripts/hermes-pilot-native-probe.py')],
          {
            cwd: plan.workspace,
            env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
            input: JSON.stringify({
              home: plan.home,
              runtime: process.env.EKYBOT_NATIVE_RUNTIME,
              packages: process.env.EKYBOT_NATIVE_PACKAGES,
              credential: {
                apiKey: 'sk-ant-api-offline-fixture',
                workspaceId: 'wrkspc_offlinefixture',
              },
              offline: true,
              ...scenario,
              input: 'Offline fixture only.',
              sessionId,
            }),
            encoding: 'utf8',
            timeout: 90000,
            maxBuffer: 1024 * 1024,
          }
        );
        if (fixturePrimaryStatus === 500) {
          assert.equal(child.status, 1);
          const diagnostic = JSON.parse(child.stdout.split('\n')[0]);
          assert.equal(diagnostic.calls, 1, 'Uncertain primary must not call fallback');
          return null;
        }
        assert.equal(child.status, 0, child.stdout || 'Native fixture did not complete');
        const result = JSON.parse(child.stdout);
        assert.equal(result.output, 'OFFLINE_NATIVE_OK');
        assert.equal(
          result.modelRequests,
          fixturePrimaryStatus === 401 || scenario.webEnabled ? 2 : 1
        );
        assert.equal(result.offline, true);
        assert.equal(result.provider, fixturePrimaryStatus === 401 ? 'anthropic' : provider);
        assert.deepEqual(
          result.webTools,
          scenario.webEnabled ? [{ tool: 'ekybot_web_read', success: true }] : []
        );
        return result;
      };
      const first = run(null);
      if (!first) {
        return;
      }
      const before = await inspectHermesSession({
        profile: plan.profile,
        homeRoot: plan.root,
        sessionId: first.sessionId,
      });
      const second = run(first.sessionId);
      assert.equal(second.sessionId, first.sessionId);
      assert.ok(second.inputMessageCount > first.inputMessageCount);
      const after = await inspectHermesSession({
        profile: plan.profile,
        homeRoot: plan.root,
        sessionId: first.sessionId,
      });
      assertPersistedContinuation(before, after);
      assert.equal(fs.statSync(path.join(plan.home, 'memories/MEMORY.md')).size, 0);
    }
  );
}
