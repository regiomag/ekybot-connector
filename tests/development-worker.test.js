const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { runDevelopmentTick, verifyProject } = require('../src/development-worker');
const { codexDevelopmentPolicy } = require('../src/development-codex-policy');
const { DevelopmentBroker } = require('../src/development-broker');
test('development worker never consumes native or Hermes queues and respects a surviving lock', async () => {
  const root = fs.mkdtempSync('/private/tmp/ekydev-worker-');
  const calls = [];
  const machine = async (body) => {
    calls.push(body);
    return body.op === 'publish' ? { projects: [] } : { job: null };
  };
  const options = { stateDir: root, machineFile: '/fixture/machine.json', machine };
  assert.equal((await runDevelopmentTick(options)).status, 'idle');
  assert.deepEqual(
    calls.map((c) => [c.action, c.op]),
    [
      ['work', 'publish'],
      ['work', 'claim'],
    ]
  );
  fs.writeFileSync(path.join(root, 'worker.lock'), 'fixture', { mode: 0o600 });
  assert.equal((await runDevelopmentTick(options)).status, 'worker-locked');
  assert.equal(calls.length, 2);
});
test('project registration validates a canonical Git root, not an arbitrary folder or symlink', () => {
  const root = fs.mkdtempSync('/private/tmp/ekydev-project-');
  execFileSync('/usr/bin/git', ['init', '-q', root]);
  execFileSync(
    '/usr/bin/git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    ],
    { cwd: root }
  );
  const p = { id: randomUUID(), path: root, name: 'Fixture' };
  assert.match(verifyProject(p).commit, /^[a-f0-9]{40}$/);
  fs.mkdirSync(path.join(root, 'nested'));
  assert.throws(() => verifyProject({ ...p, path: path.join(root, 'nested') }));
  assert.throws(() => verifyProject({ ...p, path: '/' }));
});
test('grants constrain both advertised tools and direct invocations', async () => {
  const root = fs.mkdtempSync('/private/tmp/ekydev-grants-');
  const broker = new DevelopmentBroker({
    root,
    stateDir: path.join(root, 'state'),
    runId: randomUUID(),
    role: 'developer',
    projects: [],
    approve: async () => true,
    grants: { write: false, git: false, exec: false },
  });
  assert.deepEqual(
    broker.definitions().map((t) => t.name),
    ['ekybot_projects', 'ekybot_list', 'ekybot_read']
  );
  await assert.rejects(
    broker.call('ekybot_edit', { path: 'new', oldText: '', newText: 'not allowed' }),
    /not granted/
  );
  const policy = codexDevelopmentPolicy(root, '/private/tmp/separate-native-state', false);
  const data = policy.overrides[`permissions.${policy.name}`];
  policy.assert({ permissions: { [policy.name]: data } });
  assert.equal(data.filesystem[root], 'read');
  assert.equal(data.filesystem[`${root}/**/.env`], 'deny');
  assert.throws(() =>
    policy.assert({ permissions: { [policy.name]: { ...data, network: { enabled: true } } } })
  );
});
