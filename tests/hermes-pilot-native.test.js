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

test(
  'real native Hermes persists and replays two turns without network or inherited context',
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
    writeDurableJson(path.join(plan.home, 'config.yaml'), buildPilotExecutionConfig(options));
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
            input: 'Offline fixture only.',
            sessionId,
          }),
          encoding: 'utf8',
          timeout: 90000,
          maxBuffer: 1024 * 1024,
        }
      );
      assert.equal(child.status, 0, child.stdout || 'Native fixture did not complete');
      const result = JSON.parse(child.stdout);
      assert.equal(result.output, 'OFFLINE_NATIVE_OK');
      assert.equal(result.modelRequests, 1);
      assert.equal(result.offline, true);
      return result;
    };
    const first = run(null);
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
