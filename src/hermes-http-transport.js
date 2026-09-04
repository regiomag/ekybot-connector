/**
 * Hermes runtime — HTTP transport (Runs API)
 *
 * Implements the RuntimeAdapter contract against the Hermes API Server
 * (Runs API). One Hermes profile = one Ekybot agent = one local gateway
 * process listening on its own port.
 *
 * Network calls: local only — HTTP to the Hermes gateway(s) on 127.0.0.1.
 * No third-party endpoint is contacted from this module, and no LLM provider
 * key transits through it: each gateway authenticates to its own provider
 * locally.
 *
 * Topology (decided 2026-09-04, see migration plan §12.4 / §13.3):
 *   Profile isolation is by HERMES_HOME, which implies one gateway process
 *   per profile, hence one port per profile. The profile -> base URL mapping
 *   is a static table passed in `profiles`. There is NO `/p/<profile>/`
 *   prefix: api_server.py registers no prefixed routes (only webhook.py does).
 *
 * An unknown profile throws rather than falling back to the default gateway:
 * silently running a prompt against the wrong profile would use the wrong
 * memory, skills and tools.
 */

const { assertValidProfile } = require('./runtime-adapter');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8642';

class HermesHttpTransport {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl] - Gateway serving the `default` profile.
   * @param {Record<string,string>} [options.profiles] - Static profile -> base URL table.
   * @param {string} [options.apiKey] - API_SERVER_KEY of the gateway.
   * @param {Function} [options.fetch] - Injected fetch (no real network in tests).
   * @param {Function} [options.resolveProfileBaseUrl] - Overrides resolution entirely,
   *   so a future discovery mechanism replaces one function and nothing else.
   */
  constructor(options = {}) {
    const {
      baseUrl = DEFAULT_BASE_URL,
      profiles = {},
      apiKey = null,
      fetch: fetchImpl = globalThis.fetch,
      resolveProfileBaseUrl = null,
    } = options;

    this.baseUrl = stripTrailingSlash(baseUrl);
    this.profiles = profiles;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.resolveProfileBaseUrlOverride = resolveProfileBaseUrl;
  }

  /**
   * Resolve the gateway base URL for a profile.
   * The single point to change when port discovery stops being a static table.
   */
  resolveProfileBaseUrl(profile) {
    assertValidProfile(profile);

    if (this.resolveProfileBaseUrlOverride) {
      return stripTrailingSlash(this.resolveProfileBaseUrlOverride(profile));
    }

    if (!profile || profile === 'default') {
      return this.baseUrl;
    }

    const configured = this.profiles[profile];
    if (!configured) {
      throw new Error(
        `Unknown Hermes profile "${profile}": no gateway configured. ` +
          `Add it to the profiles table (profile -> base URL).`
      );
    }

    return stripTrailingSlash(configured);
  }

  async startRun({ profile, input, sessionId, idempotencyKey } = {}) {
    const base = this.resolveProfileBaseUrl(profile);

    const headers = this.buildHeaders();
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const body = { input };
    if (sessionId) {
      body.session_id = sessionId;
    }

    const payload = await this.request(`${base}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    return { runId: payload.run_id, status: payload.status };
  }

  async getRun({ profile, runId } = {}) {
    const base = this.resolveProfileBaseUrl(profile);
    assertRunId(runId);

    const payload = await this.request(`${base}/v1/runs/${encodeURIComponent(runId)}`, {
      headers: this.buildHeaders(),
    });

    return {
      runId: payload.run_id,
      status: payload.status,
      output: payload.output,
      usage: payload.usage,
    };
  }

  async stopRun({ profile, runId } = {}) {
    const base = this.resolveProfileBaseUrl(profile);
    assertRunId(runId);

    const payload = await this.request(
      `${base}/v1/runs/${encodeURIComponent(runId)}/stop`,
      { method: 'POST', headers: this.buildHeaders() }
    );

    return { runId: payload.run_id, status: payload.status };
  }

  /**
   * Report runtime health and capabilities.
   * Deliberately returns no configuration value (no base URL, no API key):
   * this result is uploaded to Ekybot as inventory.
   */
  async discover({ profile } = {}) {
    const base = this.resolveProfileBaseUrl(profile);

    const capabilitiesPayload = await this.request(`${base}/v1/capabilities`, {
      headers: this.buildHeaders(),
    });
    const healthPayload = await this.request(`${base}/health`, {
      headers: this.buildHeaders(),
    });

    return {
      runtime: 'hermes',
      healthy: healthPayload?.status === 'ok',
      capabilities: capabilitiesPayload?.features ?? {},
    };
  }

  async health({ profile } = {}) {
    const { healthy } = await this.discover({ profile });
    return { runtime: 'hermes', healthy };
  }

  buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async request(url, options) {
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('No fetch implementation available for HermesHttpTransport');
    }

    const response = await this.fetchImpl(url, options);

    if (!response.ok) {
      const detail = await safeText(response);
      throw new Error(
        `Hermes request failed (${response.status}) on ${url}${detail ? `: ${detail}` : ''}`
      );
    }

    return response.json();
  }
}

function assertRunId(runId) {
  if (typeof runId !== 'string' || !runId.trim()) {
    throw new Error('Missing run id');
  }
}

function stripTrailingSlash(url) {
  return typeof url === 'string' ? url.replace(/\/+$/, '') : url;
}

async function safeText(response) {
  try {
    const text = await response.text();
    return text ? text.slice(0, 500) : '';
  } catch {
    return '';
  }
}

module.exports = HermesHttpTransport;
module.exports.HermesHttpTransport = HermesHttpTransport;
module.exports.DEFAULT_BASE_URL = DEFAULT_BASE_URL;
