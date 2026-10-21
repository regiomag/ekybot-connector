const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { HermesResumeGuard, readBindings } = require('../src/hermes-resume-guard');
const HermesAdapter = require('../src/hermes-adapter');

const fixtures = [];
afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-resume-test-'));
  fixtures.push(root);
  const bindingsPath = path.join(root, 'bindings.json');
  const binding = {
    conversationKey: 'agent:test:ekybot:hermes',
    profile: 'default',
    sessionId: '20261021_120000_abcdef',
    transport: 'cli',
  };
  const save = (bindings) =>
    fs.writeFileSync(bindingsPath, JSON.stringify({ version: 1, bindings }), { mode: 0o600 });
  save([binding]);
  let progress = 2;
  const inspectSession = async ({ profile, sessionId }) => ({
    profile,
    sessionId,
    home: '/fake/hermes',
    databaseIdentity: '1:2',
    activeMessages: progress,
    lastMessageId: progress,
  });
  const options = {
    bindingsPath,
    stateDir: path.join(root, 'journal'),
    inspectSession,
    ...overrides,
  };
  const guard = new HermesResumeGuard(options);
  const params = {
    profile: 'default',
    sessionId: binding.conversationKey,
    input: 'Test only',
    idempotencyKey: 'request-1',
  };
  const execute = async () => {
    progress += 2;
    return { status: 'completed', output: 'Fake answer' };
  };
  return { root, binding, bindingsPath, save, options, guard, params, execute };
}

const code = (expected) => (error) => error.code === expected && error.retryable === false;

describe('explicit Hermes bindings', () => {
  it('accepts one exact, owner-only CLI binding', () => {
    const f = fixture();
    assert.deepEqual(readBindings(f.bindingsPath), [f.binding]);
  });
  it('rejects unknown conversation, wrong profile and caller override before execution', async () => {
    const f = fixture();
    const never = async () => {
      assert.fail('runtime invoked');
    };
    await assert.rejects(
      f.guard.startRun({ ...f.params, sessionId: 'other' }, never),
      code('HERMES_BINDING_REQUIRED')
    );
    await assert.rejects(
      f.guard.startRun({ ...f.params, profile: 'other' }, never),
      code('HERMES_BINDING_REQUIRED')
    );
    await assert.rejects(
      f.guard.startRun({ ...f.params, resumeSessionId: 'wrong' }, never),
      code('HERMES_SESSION_SCOPE')
    );
  });
  it('rejects aliases, duplicate channels and one native session shared by two channels', () => {
    const f = fixture();
    for (const sessionId of ['latest', 'abc/def', 'agent:channel', '--continue', "x' OR 1=1--"]) {
      f.save([{ ...f.binding, sessionId }]);
      assert.throws(() => readBindings(f.bindingsPath), code('HERMES_INVALID_SESSION'));
    }
    f.save([f.binding, f.binding]);
    assert.throws(() => readBindings(f.bindingsPath), code('HERMES_AMBIGUOUS_BINDING'));
    f.save([f.binding, { ...f.binding, conversationKey: 'another-channel' }]);
    assert.throws(() => readBindings(f.bindingsPath), code('HERMES_AMBIGUOUS_BINDING'));
  });
  it('rejects HTTP, malformed JSON, public permissions and symlinks', () => {
    const f = fixture();
    f.save([{ ...f.binding, transport: 'http' }]);
    assert.throws(() => readBindings(f.bindingsPath), code('HERMES_INVALID_BINDINGS'));
    fs.writeFileSync(f.bindingsPath, '{');
    assert.throws(() => readBindings(f.bindingsPath), code('HERMES_UNSAFE_STATE'));
    f.save([f.binding]);
    fs.chmodSync(f.bindingsPath, 0o644);
    assert.throws(() => readBindings(f.bindingsPath), code('HERMES_UNSAFE_STATE'));
    fs.chmodSync(f.bindingsPath, 0o600);
    const linked = path.join(f.root, 'link.json');
    fs.symlinkSync(f.bindingsPath, linked);
    assert.throws(() => readBindings(linked), code('HERMES_UNSAFE_STATE'));
  });
  it('requires idempotency and refuses silently ignored system instructions', async () => {
    const f = fixture();
    await assert.rejects(
      f.guard.startRun({ ...f.params, idempotencyKey: '' }, f.execute),
      code('HERMES_REQUEST_ID_REQUIRED')
    );
    await assert.rejects(
      f.guard.startRun({ ...f.params, systemPrompt: 'Must be applied' }, f.execute),
      code('HERMES_INSTRUCTIONS_UNSUPPORTED')
    );
    assert.equal(fs.existsSync(f.options.stateDir), false);
  });
  it('performs metadata-only preflight without creating a journal', async () => {
    const f = fixture();
    assert.equal((await f.guard.preflight(f.params)).snapshot.activeMessages, 2);
    assert.equal(fs.existsSync(f.options.stateDir), false);
  });
});

describe('durable conservative resume gate', () => {
  it('forwards the native id separately, persists before execution, and replays after restart', async () => {
    const f = fixture();
    let calls = 0;
    const handle = await f.guard.startRun(f.params, async (bound) => {
      calls++;
      assert.equal(bound.sessionId, f.binding.conversationKey);
      assert.equal(bound.resumeSessionId, f.binding.sessionId);
      const receipt = fs.readdirSync(f.options.stateDir).find((file) => file.endsWith('.json'));
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(f.options.stateDir, receipt))).status,
        'started'
      );
      return f.execute();
    });
    const rebooted = new HermesResumeGuard(f.options);
    const replayed = await rebooted.startRun(f.params, async () => {
      calls++;
      assert.fail('must not rerun');
    });
    assert.equal(calls, 1);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.runId, handle.runId);
    assert.equal(
      rebooted.getRun({ profile: 'default', runId: handle.runId }).output,
      'Fake answer'
    );
    assert.equal(
      fs.readdirSync(f.options.stateDir).filter((file) => file.endsWith('.lock')).length,
      0
    );
    assert.equal(
      fs.statSync(path.join(f.options.stateDir, `${handle.runId}.json`)).mode & 0o077,
      0
    );
  });
  it('rejects the same request id reused with another input or native session', async () => {
    const f = fixture();
    await f.guard.startRun(f.params, f.execute);
    await assert.rejects(
      f.guard.startRun({ ...f.params, input: 'Different' }, f.execute),
      code('HERMES_REQUEST_CONFLICT')
    );
    f.save([{ ...f.binding, sessionId: 'different-session' }]);
    await assert.rejects(f.guard.startRun(f.params, f.execute), code('HERMES_REQUEST_CONFLICT'));
  });
  it('keeps the lock and intent across a runtime failure and a process restart', async () => {
    const f = fixture();
    await assert.rejects(
      f.guard.startRun(f.params, async () => {
        throw new Error('process terminated');
      }),
      code('HERMES_RECONCILIATION_REQUIRED')
    );
    const rebooted = new HermesResumeGuard(f.options);
    await assert.rejects(
      rebooted.startRun(f.params, f.execute),
      code('HERMES_RECONCILIATION_REQUIRED')
    );
    await assert.rejects(
      rebooted.startRun({ ...f.params, idempotencyKey: 'new-request' }, f.execute),
      code('HERMES_SESSION_BUSY')
    );
  });
  it('blocks two workers and different requests from resuming the same session concurrently', async () => {
    const f = fixture();
    let release;
    let entered;
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    const first = f.guard.startRun(f.params, async () => {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
      return f.execute();
    });
    await ready;
    const second = new HermesResumeGuard(f.options);
    await assert.rejects(
      second.startRun({ ...f.params, idempotencyKey: 'request-2' }, f.execute),
      code('HERMES_SESSION_BUSY')
    );
    release();
    await first;
  });
  it('does not accept stdout without history being persisted in the bound session', async () => {
    const f = fixture();
    await assert.rejects(
      f.guard.startRun(f.params, async () => ({ status: 'completed', output: 'Not persisted' })),
      code('HERMES_RECONCILIATION_REQUIRED')
    );
    assert.equal(
      fs.readdirSync(f.options.stateDir).filter((file) => file.endsWith('.lock')).length,
      1
    );
    const receiptFile = fs.readdirSync(f.options.stateDir).find((file) => file.endsWith('.json'));
    const receipt = JSON.parse(fs.readFileSync(path.join(f.options.stateDir, receiptFile)));
    assert.equal(receipt.status, 'verifying');
    assert.equal(receipt.output, 'Not persisted');
    assert.throws(
      () => f.guard.getRun({ profile: 'default', runId: receipt.runId }),
      code('HERMES_RECONCILIATION_REQUIRED')
    );
  });
  it('retains intent after an actual child process exits during the fake execution', async () => {
    const f = fixture();
    // This child runs only the guard with fake metadata. No Hermes process,
    // provider SDK or network client is invoked.
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `
      const { HermesResumeGuard } = require(process.argv[1]);
      const options = JSON.parse(process.argv[2]);
      const params = JSON.parse(process.argv[3]);
      options.inspectSession = async ({ profile, sessionId }) => ({
        profile, sessionId, home: '/fake/hermes', databaseIdentity: '1:2',
        activeMessages: 2, lastMessageId: 2,
      });
      new HermesResumeGuard(options).startRun(params, async () => {
        process.exit(27);
      }).catch(() => process.exit(28));
    `,
        require.resolve('../src/hermes-resume-guard'),
        JSON.stringify(f.options),
        JSON.stringify(f.params),
      ],
      { timeout: 5000 }
    );
    assert.equal(child.status, 27, child.stderr?.toString());
    await assert.rejects(
      f.guard.startRun(f.params, async () => {
        assert.fail('must not rerun');
      }),
      code('HERMES_RECONCILIATION_REQUIRED')
    );
    assert.equal(
      fs.readdirSync(f.options.stateDir).filter((file) => file.endsWith('.lock')).length,
      1
    );
  });
  it('blocks database replacement or session switching during execution', async () => {
    let inspections = 0;
    const f = fixture({
      inspectSession: async ({ profile, sessionId }) => ({
        profile,
        sessionId,
        home: '/fake',
        databaseIdentity: inspections++ ? 'replaced' : 'original',
        activeMessages: inspections * 2,
        lastMessageId: inspections * 2,
      }),
    });
    await assert.rejects(
      f.guard.startRun(f.params, f.execute),
      code('HERMES_RECONCILIATION_REQUIRED')
    );
  });
  it('releases a lock after a failed preflight that never invoked Hermes', async () => {
    const f = fixture({
      inspectSession: async () => {
        throw new Error('database unavailable');
      },
    });
    await assert.rejects(
      f.guard.startRun(f.params, async () => {
        assert.fail('must not execute');
      }),
      /database unavailable/
    );
    assert.deepEqual(fs.readdirSync(f.options.stateDir), []);
  });
  it('rejects an unsafe journal directory', async () => {
    const f = fixture();
    fs.mkdirSync(f.options.stateDir, { mode: 0o755 });
    await assert.rejects(f.guard.startRun(f.params, f.execute), code('HERMES_UNSAFE_STATE'));
  });
  it('does not expose completed receipts after revocation or to another profile', async () => {
    const f = fixture();
    const handle = await f.guard.startRun(f.params, f.execute);
    assert.throws(
      () => f.guard.getRun({ profile: 'other', runId: handle.runId }),
      code('HERMES_SESSION_SCOPE')
    );
    f.save([{ ...f.binding, conversationKey: 'new-scope' }]);
    assert.throws(
      () => f.guard.getRun({ profile: 'default', runId: handle.runId }),
      code('HERMES_BINDING_REQUIRED')
    );
  });
});

describe('facade integration', () => {
  it('fails closed if required resume loses its bindings configuration', () => {
    assert.throws(
      () => new HermesAdapter({ env: { EKYBOT_HERMES_REQUIRE_RESUME: '1' } }),
      code('HERMES_BINDING_REQUIRED')
    );
    assert.throws(
      () => new HermesAdapter({ env: {}, requireResume: true }),
      code('HERMES_BINDING_REQUIRED')
    );
  });
  it('pins the verified CLI path without HTTP probing and replays a persisted result', async () => {
    const f = fixture();
    let params;
    let calls = 0;
    const adapter = new HermesAdapter({
      env: {},
      resumeGuard: f.guard,
      httpTransport: {
        discover: async () => {
          assert.fail('HTTP probe forbidden');
        },
      },
      cliTransport: {
        startRun: async (p) => {
          params = p;
          calls++;
          return { runId: 'cli_test', status: 'completed' };
        },
        getRun: f.execute,
      },
    });
    assert.equal((await adapter.selectTransport()).name, 'cli');
    const first = await adapter.runToCompletion(f.params);
    const second = await adapter.runToCompletion(f.params);
    assert.equal(first.content, 'Fake answer');
    assert.equal(second.runId, first.runId);
    assert.equal(calls, 1);
    assert.equal(params.resumeSessionId, f.binding.sessionId);
  });
  it('refuses forced HTTP conflicting with the local binding', () => {
    const f = fixture();
    assert.throws(
      () => new HermesAdapter({ env: {}, transport: 'http', resumeGuard: f.guard }),
      code('HERMES_TRANSPORT_CONFLICT')
    );
  });
  it('refuses a native session override without a local binding', async () => {
    const adapter = new HermesAdapter({ env: {} });
    await assert.rejects(
      adapter.startRun({ resumeSessionId: 'native', input: 'hi' }),
      code('HERMES_BINDING_REQUIRED')
    );
  });
});
