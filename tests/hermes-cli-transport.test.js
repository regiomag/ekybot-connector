const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const HermesCliTransport = require('../src/hermes-cli-transport');

const okResult = (content = 'Done') => ({
  content,
  model: 'hermes/openrouter',
  billingType: 'api',
  exitCode: 0,
});

describe('HermesCliTransport', () => {
  it('runs synchronously and reports a terminal status', async () => {
    const calls = [];
    const transport = new HermesCliTransport({
      execute: async (input, options) => {
        calls.push({ input, options });
        return okResult('Summarized');
      },
    });

    const handle = await transport.startRun({ profile: 'research', input: 'Summarize this' });

    assert.equal(handle.status, 'completed');
    assert.match(handle.runId, /^cli_/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, 'Summarize this');
    assert.equal(calls[0].options.profile, 'research');

    assert.deepEqual(await transport.getRun({ runId: handle.runId }), {
      runId: handle.runId,
      status: 'completed',
      output: 'Summarized',
      usage: undefined,
    });
  });

  it('rejects a traversing profile name before it reaches the filesystem', async () => {
    // hermes-client resolves HERMES_HOME with path.join(~/.hermes/profiles, profile),
    // so '../..' escapes the profiles directory.
    const transport = new HermesCliTransport({
      execute: async () => { throw new Error('must not execute'); },
    });

    await assert.rejects(
      () => transport.startRun({ profile: '../../etc', input: 'hi' }),
      /Invalid Hermes profile/,
    );
  });

  it('replays a successful run for the same idempotency key without executing twice', async () => {
    let executions = 0;
    const transport = new HermesCliTransport({
      execute: async () => {
        executions += 1;
        return okResult();
      },
    });

    const first = await transport.startRun({ input: 'hi', idempotencyKey: 'relay-1' });
    const second = await transport.startRun({ input: 'hi', idempotencyKey: 'relay-1' });

    assert.equal(executions, 1);
    assert.equal(second.runId, first.runId);
    assert.equal(second.replayed, true);
  });

  it('does not reserve the idempotency key when the run fails, so a retry re-executes', async () => {
    let executions = 0;
    const transport = new HermesCliTransport({
      execute: async () => {
        executions += 1;
        if (executions === 1) throw new Error('transient boom');
        return okResult('recovered');
      },
    });

    await assert.rejects(
      () => transport.startRun({ input: 'hi', idempotencyKey: 'relay-2' }),
      /transient boom/
    );

    const retry = await transport.startRun({ input: 'hi', idempotencyKey: 'relay-2' });

    assert.equal(executions, 2);
    assert.equal(retry.status, 'completed');
  });

  it('cannot cancel: stopRun reports the terminal status instead', async () => {
    const transport = new HermesCliTransport({ execute: async () => okResult() });
    const handle = await transport.startRun({ input: 'hi' });

    assert.deepEqual(await transport.stopRun({ runId: handle.runId }), {
      runId: handle.runId,
      status: 'completed',
      stopSupported: false,
    });
  });

  it('rejects an unknown run id', async () => {
    const transport = new HermesCliTransport({ execute: async () => okResult() });
    await assert.rejects(() => transport.getRun({ runId: 'nope' }), /Unknown Hermes run/);
  });

  it('reports capabilities that match what the CLI can actually do', async () => {
    const transport = new HermesCliTransport({
      execute: async () => okResult(),
      healthCheck: async () => ({ available: true, version: 'hermes 0.21.0', error: null }),
    });

    assert.deepEqual(await transport.discover(), {
      runtime: 'hermes',
      healthy: true,
      capabilities: {
        run_submission: true,
        run_stop: false,
        run_events: false,
        run_approval: false,
        durable_idempotency: false,
      },
    });
  });

  it('reports unhealthy when the CLI is missing', async () => {
    const transport = new HermesCliTransport({
      execute: async () => okResult(),
      healthCheck: async () => ({ available: false, version: null, error: 'not installed' }),
    });

    assert.deepEqual(await transport.health(), { runtime: 'hermes', healthy: false });
  });

  it('bounds the in-memory run store', async () => {
    const transport = new HermesCliTransport({
      execute: async () => okResult(),
      maxTrackedRuns: 2,
    });

    const a = await transport.startRun({ input: '1', idempotencyKey: 'k1' });
    await transport.startRun({ input: '2' });
    await transport.startRun({ input: '3' });

    assert.equal(transport.runs.size, 2);
    await assert.rejects(() => transport.getRun({ runId: a.runId }), /Unknown Hermes run/);
    // the evicted run's idempotency key is released with it
    assert.equal(transport.idempotency.has('k1'), false);
  });
});
