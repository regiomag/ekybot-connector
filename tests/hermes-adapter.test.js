/**
 * NOTE (2026-09-04) — profile topology corrected.
 *
 * Two of these tests previously asserted URLs of the form
 * `http://127.0.0.1:8642/p/research/v1/runs`. That prefix does not exist:
 * `api_server.py` registers /health, /v1/models, /v1/capabilities, /v1/runs…
 * with no prefixed variant; only `webhook.py` registers
 * `/p/{profile}/webhooks/{route}`.
 *
 * Decided topology: one gateway process per profile (profile isolation is by
 * HERMES_HOME), so one port per profile, resolved through a static
 * profile -> base URL table. See migration plan §12.4 / §13.3.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const HermesAdapter = require('../src/hermes-adapter');

// Static profile table: `research` runs on its own gateway/port.
const PROFILES = { research: 'http://127.0.0.1:8643' };

describe('HermesAdapter', () => {
  it('rejects unsafe profile names before sending a request', async () => {
    const adapter = new HermesAdapter({ fetch: async () => { throw new Error('must not fetch'); } });

    await assert.rejects(
      () => adapter.startRun({ profile: '../unsafe', input: 'hello', idempotencyKey: 'request-1' }),
      /Invalid Hermes profile/
    );
  });

  it('rejects a profile with no configured gateway instead of falling back', async () => {
    const adapter = new HermesAdapter({
      baseUrl: 'http://127.0.0.1:8642',
      fetch: async () => { throw new Error('must not fetch'); },
    });

    await assert.rejects(
      () => adapter.startRun({ profile: 'research', input: 'hello' }),
      /Unknown Hermes profile/
    );
  });

  it('starts an idempotent run against the selected local profile', async () => {
    const requests = [];
    const adapter = new HermesAdapter({
      baseUrl: 'http://127.0.0.1:8642',
      profiles: PROFILES,
      apiKey: 'local-key',
      fetch: async (url, options) => {
        requests.push({ url, options });
        return jsonResponse({ run_id: 'run_123', status: 'started' });
      },
    });

    const result = await adapter.startRun({
      profile: 'research',
      input: 'Summarize this',
      sessionId: 'channel-research',
      idempotencyKey: 'relay-123',
    });

    assert.deepEqual(result, { runId: 'run_123', status: 'started' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://127.0.0.1:8643/v1/runs');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer local-key');
    assert.equal(requests[0].options.headers['Idempotency-Key'], 'relay-123');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      input: 'Summarize this',
      session_id: 'channel-research',
    });
  });

  it('routes the default profile to the base gateway', async () => {
    const requests = [];
    const adapter = new HermesAdapter({
      baseUrl: 'http://127.0.0.1:8642',
      profiles: PROFILES,
      fetch: async (url, options) => {
        requests.push({ url, options });
        return jsonResponse({ run_id: 'run_9', status: 'started' });
      },
    });

    await adapter.startRun({ profile: 'default', input: 'hi' });
    assert.equal(requests[0].url, 'http://127.0.0.1:8642/v1/runs');
  });

  it('reports health and capabilities without exposing configuration values', async () => {
    const adapter = new HermesAdapter({
      fetch: async (url) => {
        if (url.endsWith('/v1/capabilities')) {
          return jsonResponse({ features: { run_submission: true, run_stop: true } });
        }
        return jsonResponse({ status: 'ok' });
      },
    });

    const status = await adapter.discover();

    assert.deepEqual(status, {
      runtime: 'hermes',
      healthy: true,
      capabilities: { run_submission: true, run_stop: true },
    });
  });

  it('gets and stops a run through the profile endpoint', async () => {
    const requests = [];
    const adapter = new HermesAdapter({
      profiles: PROFILES,
      fetch: async (url, options = {}) => {
        requests.push({ url, options });
        if (options.method === 'POST') return jsonResponse({ run_id: 'run_123', status: 'cancelled' });
        return jsonResponse({ run_id: 'run_123', status: 'completed', output: 'Done' });
      },
    });

    assert.deepEqual(await adapter.getRun({ profile: 'research', runId: 'run_123' }), {
      runId: 'run_123', status: 'completed', output: 'Done', usage: undefined,
    });
    assert.deepEqual(await adapter.stopRun({ profile: 'research', runId: 'run_123' }), {
      runId: 'run_123', status: 'cancelled',
    });
    assert.equal(requests[0].url, 'http://127.0.0.1:8643/v1/runs/run_123');
    assert.equal(requests[1].url, 'http://127.0.0.1:8643/v1/runs/run_123/stop');
    assert.equal(requests[1].options.method, 'POST');
  });

  it('resolution is injectable so port discovery can change in one place', async () => {
    const requests = [];
    const adapter = new HermesAdapter({
      resolveProfileBaseUrl: (profile) => `http://127.0.0.1:9000/${profile}`,
      fetch: async (url, options) => {
        requests.push({ url, options });
        return jsonResponse({ run_id: 'run_1', status: 'started' });
      },
    });

    await adapter.startRun({ profile: 'research', input: 'hi' });
    assert.equal(requests[0].url, 'http://127.0.0.1:9000/research/v1/runs');
  });
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}
