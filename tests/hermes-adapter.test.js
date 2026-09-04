const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const HermesAdapter = require('../src/hermes-adapter');

function fakeTransport(name, { discoverImpl } = {}) {
  return {
    name,
    calls: [],
    async startRun(params) {
      this.calls.push(['startRun', params]);
      return { runId: `${name}_run`, status: 'started' };
    },
    async getRun(params) {
      this.calls.push(['getRun', params]);
      return { runId: `${name}_run`, status: 'completed' };
    },
    async stopRun(params) {
      this.calls.push(['stopRun', params]);
      return { runId: `${name}_run`, status: 'cancelled' };
    },
    async discover() {
      this.calls.push(['discover']);
      if (discoverImpl) return discoverImpl();
      return { runtime: 'hermes', healthy: true, capabilities: {} };
    },
    async health() {
      this.calls.push(['health']);
      return { runtime: 'hermes', healthy: true };
    },
  };
}

function adapterWith({ httpDiscover, env = {}, transport } = {}) {
  const httpTransport = fakeTransport('http', { discoverImpl: httpDiscover });
  const cliTransport = fakeTransport('cli');
  const adapter = new HermesAdapter({ httpTransport, cliTransport, env, transport });
  return { adapter, httpTransport, cliTransport };
}

describe('HermesAdapter transport selection', () => {
  it('uses HTTP when the API Server answers /v1/capabilities', async () => {
    const { adapter, httpTransport, cliTransport } = adapterWith();

    await adapter.startRun({ input: 'hi' });

    assert.equal(httpTransport.calls.some(([m]) => m === 'startRun'), true);
    assert.equal(cliTransport.calls.length, 0);
  });

  it('falls back to the CLI when the API Server is unreachable', async () => {
    const { adapter, cliTransport } = adapterWith({
      httpDiscover: () => { throw new Error('ECONNREFUSED'); },
    });

    await adapter.startRun({ input: 'hi' });

    assert.equal(cliTransport.calls.some(([m]) => m === 'startRun'), true);
  });

  it('EKYBOT_HERMES_TRANSPORT overrides the probe', async () => {
    const { adapter, httpTransport, cliTransport } = adapterWith({
      env: { EKYBOT_HERMES_TRANSPORT: 'cli' },
    });

    await adapter.startRun({ input: 'hi' });

    // forced: the probe never runs
    assert.equal(httpTransport.calls.length, 0);
    assert.equal(cliTransport.calls.some(([m]) => m === 'startRun'), true);
  });

  it('an explicit transport option wins over the environment', async () => {
    const { adapter, httpTransport } = adapterWith({
      env: { EKYBOT_HERMES_TRANSPORT: 'cli' },
      transport: 'http',
    });

    await adapter.startRun({ input: 'hi' });

    assert.equal(httpTransport.calls.some(([m]) => m === 'startRun'), true);
  });

  it('ignores an unrecognised transport value and probes instead', async () => {
    const { adapter, httpTransport } = adapterWith({
      env: { EKYBOT_HERMES_TRANSPORT: 'carrier-pigeon' },
    });

    await adapter.startRun({ input: 'hi' });

    assert.equal(httpTransport.calls.some(([m]) => m === 'discover'), true);
  });

  it('probes once and memoizes the result', async () => {
    let probes = 0;
    const { adapter } = adapterWith({
      httpDiscover: () => {
        probes += 1;
        return { runtime: 'hermes', healthy: true, capabilities: {} };
      },
    });

    await adapter.startRun({ input: 'a' });
    await adapter.startRun({ input: 'b' });
    await adapter.getRun({ runId: 'x' });

    assert.equal(probes, 1);
  });

  it('re-probes after resetTransportSelection()', async () => {
    let probes = 0;
    const { adapter } = adapterWith({
      httpDiscover: () => {
        probes += 1;
        return { runtime: 'hermes', healthy: true, capabilities: {} };
      },
    });

    await adapter.startRun({ input: 'a' });
    adapter.resetTransportSelection();
    await adapter.startRun({ input: 'b' });

    assert.equal(probes, 2);
  });

  it('discover() reports which transport is in use', async () => {
    const { adapter } = adapterWith({
      httpDiscover: () => { throw new Error('down'); },
    });

    const status = await adapter.discover();

    assert.equal(status.transport, 'cli');
    assert.equal(status.runtime, 'hermes');
  });

  it('delegates stopRun to the selected transport', async () => {
    const { adapter, httpTransport } = adapterWith({ transport: 'http' });

    const result = await adapter.stopRun({ profile: 'research', runId: 'run_1' });

    assert.equal(result.status, 'cancelled');
    assert.equal(httpTransport.calls.some(([m]) => m === 'stopRun'), true);
  });
});
