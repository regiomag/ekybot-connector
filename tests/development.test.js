const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DevelopmentBroker } = require('../src/development-broker');
const { permittedPath, redact } = require('../src/development-files');
const { validateTool } = require('../src/development-tools');
const { runSandboxed } = require('../src/development-command');
function fixture() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ekybot-dev-test-'));
  const workspace = path.join(root, 'project');
  fs.mkdirSync(workspace, { mode: 0o700 });
  const stateDir = path.join(root, 'state');
  const broker = new DevelopmentBroker({
    root: workspace,
    stateDir,
    runId: crypto.randomUUID(),
    role: 'developer',
    projects: [],
    approve: async () => false,
  });
  return { root, workspace, stateDir, broker };
}
test('development tools reject unknown arguments and credentials', async () => {
  assert.throws(() =>
    validateTool('ekybot_exec', {
      command: '/bin/echo',
      args: [],
      reason: 'test',
      env: { SECRET: 'x' },
    })
  );
  const f = fixture();
  await assert.rejects(
    f.broker.call('ekybot_edit', {
      path: 'note',
      oldText: '',
      newText: 'sk-ant-api03-' + 'a'.repeat(40),
    }),
    /credentials/
  );
});
test('file boundaries reject traversal, symlinks and secret configuration', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, 'outside'), 'private');
  fs.symlinkSync(path.join(f.root, 'outside'), path.join(f.workspace, 'alias'));
  for (const target of ['../outside', 'alias', '.env', '.git/config']) {
    assert.throws(() => permittedPath({ root: f.workspace }, target));
  }
  assert.equal(
    permittedPath({ root: f.workspace, orchestrator: true }, path.join(f.root, 'outside')),
    path.join(f.root, 'outside')
  );
  assert.match(redact('sk-ant-api03-' + 'a'.repeat(40)), /REDACTED/);
});
test('edits preserve recovery and replay once, no outside writes for Hermes', async () => {
  const f = fixture();
  const input = { path: 'hello.txt', oldText: '', newText: 'hello' };
  const first = await f.broker.call('ekybot_edit', input, 'same-call');
  assert.deepEqual(await f.broker.call('ekybot_edit', input, 'same-call'), first);
  assert.equal(fs.readFileSync(path.join(f.workspace, 'hello.txt'), 'utf8'), 'hello');
  assert.equal(fs.readdirSync(f.stateDir).filter((p) => p.endsWith('.before.json')).length, 1);
  const conflict = await f.broker.call('ekybot_edit', { ...input, newText: 'nope' });
  assert.match(conflict.error, /uncertain/);
  assert.throws(() =>
    permittedPath({ root: f.workspace, orchestrator: true }, '../outside', {
      write: true,
      create: true,
    })
  );
});
test('command denied without approval, uncertain effect never replays', async () => {
  const f = fixture();
  let calls = 0;
  f.broker.runCommand = async () => {
    calls++;
    throw new Error('transport lost');
  };
  const input = { command: '/bin/echo', args: ['hello'], reason: 'fixture' };
  assert.equal((await f.broker.call('ekybot_exec', input)).denied, true);
  assert.equal(calls, 0);
  f.broker.approve = async () => true;
  assert.match((await f.broker.call('ekybot_exec', input, 'uncertain')).error, /uncertain/);
  await assert.rejects(f.broker.call('ekybot_exec', input, 'uncertain'), /uncertain/);
  assert.equal(calls, 1);
  await assert.rejects(f.broker.call('ekybot_exec', input, 'different-call'), /uncertain/);
  const restored = new DevelopmentBroker({
    root: f.workspace,
    stateDir: f.stateDir,
    runId: f.broker.runId,
    role: 'developer',
    projects: [],
    approve: async () => true,
  });
  await assert.rejects(
    restored.call('ekybot_edit', { path: 'another.txt', oldText: '', newText: 'no' }),
    /uncertain/
  );
  assert.equal((await restored.call('ekybot_list', { path: '.' })).path, f.workspace);
});
test('developers cannot delegate and cancellation precedes tools', async () => {
  const f = fixture();
  await assert.rejects(
    f.broker.call('ekybot_delegate', {
      projectId: 'other',
      engine: 'codex',
      task: 'do something',
    }),
    /not granted/
  );
  f.broker.cancelled = async () => true;
  await assert.rejects(f.broker.call('ekybot_projects', {}), /cancelled/);
});
test('commands require an explicit qualified adapter and a bound root', async () => {
  await assert.rejects(
    runSandboxed({ command: '/bin/echo', args: ['fixture'] }),
    /Invalid sandbox command/
  );
  const f = fixture();
  assert.equal(
    f.broker.definitions().some((tool) => tool.name === 'ekybot_exec'),
    false
  );
  f.broker.approve = async () => true;
  await assert.rejects(
    f.broker.call('ekybot_exec', {
      command: '/bin/echo',
      args: ['fixture'],
      reason: 'fixture',
    }),
    /not granted/
  );
});
test('cancellation after approval prevents the effect and child error text stays private', async () => {
  const f = fixture();
  let cancelled = false,
    calls = 0;
  const input = { command: '/bin/echo', args: ['fixture'], reason: 'fixture' };
  f.broker.cancelled = async () => cancelled;
  f.broker.approve = async () => {
    cancelled = true;
    return true;
  };
  f.broker.runCommand = async () => {
    calls++;
  };
  assert.match((await f.broker.call('ekybot_exec', input)).reason, /cancelled/);
  assert.equal(calls, 0);
  const g = fixture();
  g.broker.approve = async () => true;
  g.broker.runCommand = async () => {
    throw Object.assign(new Error('UNKNOWN_PRIVATE_CHILD_OUTPUT'), {
      stderr: 'UNKNOWN_PRIVATE_CHILD_OUTPUT',
    });
  };
  const result = await g.broker.call('ekybot_exec', input);
  assert.doesNotMatch(JSON.stringify(result), /UNKNOWN_PRIVATE_CHILD_OUTPUT/);
  for (const file of fs.readdirSync(g.stateDir)) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(g.stateDir, file), 'utf8'),
      /UNKNOWN_PRIVATE_CHILD_OUTPUT/
    );
  }
});
