'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildIsolatedContainerArgs, planProtectedLocalRuntime } = require('../src/protected-local-sandbox');
const run = '11111111-1111-4111-8111-111111111111';
const image = `sha256:${'a'.repeat(64)}`;

test('le plan interdit réseau, montages, privilèges et récupération automatique', () => {
  const args = buildIsolatedContainerArgs(run, image);
  for (const option of ['--network=none', '--ipc=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true', '--pull=never', '--log-driver=none', '--user=65534:65534']) {
    assert.ok(args.includes(option), option);
  }
  assert.equal(args.at(-1), image);
  assert.ok(!args.some((arg) => /^(--mount|--volume|--privileged|--env-file|--network=host)/.test(arg)));
  assert.deepEqual(args.filter((value, index) => index > 0 && args[index - 1] === '--env'), ['HOME=/tmp', 'LANG=C.UTF-8']);
  assert.ok(Object.isFrozen(args));
});

test('refuse un runtime non qualifié et les images ou identifiants injectés', () => {
  for (const [id, ref] of [[run, 'image:latest'], [run, `${image} --privileged`], ['../secret', image]]) {
    assert.throws(() => buildIsolatedContainerArgs(id, ref), /protected_runtime_unavailable/);
  }
  assert.throws(() => planProtectedLocalRuntime('codex', run), /protected_runtime_unavailable/);
});
