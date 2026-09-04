/**
 * Hermes Runtime Adapter — facade
 *
 * Implements the RuntimeAdapter contract (see runtime-adapter.js) and
 * delegates to one of two transports:
 *
 *   HermesHttpTransport  — Runs API, the target (plan §5.2)
 *   HermesCliTransport   — `hermes chat -q` subprocess, the existing path
 *
 * Network calls: none of its own; see the transports.
 *
 * Transport selection (plan §13.2), in order:
 *   1. EKYBOT_HERMES_TRANSPORT=http|cli   — explicit escape hatch
 *   2. GET /v1/capabilities answers        — http
 *   3. otherwise                           — cli
 *
 * The probe result is memoized: bringing the API Server up on a running
 * daemon does not switch transport until the daemon restarts, or until
 * something calls resetTransportSelection(). That is deliberate — re-probing
 * on every run would add a round trip to each relay message.
 *
 * The CLI transport is a migration stopgap. Per plan §13.2 it is acceptable
 * until the end of Phase 2 and forbidden in Phase 3 for any new agent; its
 * removal is a Phase 3 acceptance criterion.
 */

const { assertValidProfile } = require('./runtime-adapter');
const HermesHttpTransport = require('./hermes-http-transport');
const HermesCliTransport = require('./hermes-cli-transport');

const VALID_TRANSPORTS = new Set(['http', 'cli']);

class HermesAdapter {
  /**
   * @param {object} options
   * @param {object} [options.http] - Options forwarded to HermesHttpTransport.
   * @param {object} [options.cli] - Options forwarded to HermesCliTransport.
   * @param {'http'|'cli'} [options.transport] - Force a transport (skips the probe).
   * @param {object} [options.env] - Environment to read EKYBOT_HERMES_TRANSPORT from.
   * @param {object} [options.httpTransport] - Pre-built transport (tests).
   * @param {object} [options.cliTransport] - Pre-built transport (tests).
   */
  constructor(options = {}) {
    const {
      http = {},
      cli = {},
      transport = null,
      env = process.env,
      httpTransport = null,
      cliTransport = null,
    } = options;

    this.httpTransport = httpTransport || new HermesHttpTransport(http);
    this.cliTransport = cliTransport || new HermesCliTransport(cli);

    this.forcedTransport = normalizeTransport(transport) || readEnvTransport(env);
    this.selectedName = null;
    this.selectionPromise = null;
  }

  /**
   * Resolve which transport to use, memoized.
   * @returns {Promise<{name: 'http'|'cli', transport: object}>}
   */
  async selectTransport() {
    if (this.forcedTransport) {
      this.selectedName = this.forcedTransport;
      return { name: this.forcedTransport, transport: this.transportByName(this.forcedTransport) };
    }

    if (!this.selectionPromise) {
      this.selectionPromise = this.probeTransport();
    }

    const name = await this.selectionPromise;
    this.selectedName = name;
    return { name, transport: this.transportByName(name) };
  }

  async probeTransport() {
    try {
      await this.httpTransport.discover();
      return 'http';
    } catch {
      return 'cli';
    }
  }

  /** Forget the memoized probe, e.g. after the API Server has been enabled. */
  resetTransportSelection() {
    this.selectionPromise = null;
    this.selectedName = null;
  }

  transportByName(name) {
    return name === 'http' ? this.httpTransport : this.cliTransport;
  }

  async startRun(params) {
    assertValidProfile(params?.profile);
    const { transport } = await this.selectTransport();
    return transport.startRun(params);
  }

  async getRun(params) {
    assertValidProfile(params?.profile);
    const { transport } = await this.selectTransport();
    return transport.getRun(params);
  }

  /**
   * Start a run and return its output once terminal.
   *
   * The relay expects one call that yields the answer. The CLI transport is
   * already synchronous, so this costs one extra getRun; the HTTP transport
   * returns 'started' and is polled here, which keeps run-awareness inside the
   * adapter instead of spreading it through the relay.
   *
   * A failed run throws, matching what executeHermes did before.
   *
   * @returns {Promise<{content: string, runId: string, status: string, usage?: object}>}
   */
  async runToCompletion(params = {}, options = {}) {
    const {
      pollIntervalMs = 1_000,
      maxWaitMs = null,
      sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    } = options;

    const handle = await this.startRun(params);
    let run = isTerminalStatus(handle.status)
      ? await this.getRun({ profile: params.profile, runId: handle.runId })
      : null;

    if (!run) {
      const deadline = maxWaitMs ? Date.now() + maxWaitMs : null;
      for (;;) {
        await sleep(pollIntervalMs);
        const polled = await this.getRun({ profile: params.profile, runId: handle.runId });
        if (isTerminalStatus(polled.status)) {
          run = polled;
          break;
        }
        if (deadline && Date.now() >= deadline) {
          throw new Error(
            `Hermes run ${handle.runId} still ${polled.status} after ${maxWaitMs}ms`
          );
        }
      }
    }

    if (run.status === 'failed') {
      throw new Error(`Hermes run ${run.runId} failed${run.output ? `: ${run.output}` : ''}`);
    }

    return {
      content: run.output,
      runId: run.runId,
      status: run.status,
      usage: run.usage,
    };
  }

  async stopRun(params) {
    assertValidProfile(params?.profile);
    const { transport } = await this.selectTransport();
    return transport.stopRun(params);
  }

  /**
   * Reports health, capabilities and which transport is in use.
   * Returns no configuration value: this result is uploaded to Ekybot as
   * inventory.
   */
  async discover(params) {
    const { name, transport } = await this.selectTransport();
    const status = await transport.discover(params);
    return { ...status, transport: name };
  }

  async health(params) {
    const { transport } = await this.selectTransport();
    return transport.health(params);
  }
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

function normalizeTransport(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return VALID_TRANSPORTS.has(normalized) ? normalized : null;
}

function readEnvTransport(env) {
  return normalizeTransport(env && env.EKYBOT_HERMES_TRANSPORT);
}

module.exports = HermesAdapter;
module.exports.HermesAdapter = HermesAdapter;
module.exports.HermesHttpTransport = HermesHttpTransport;
module.exports.HermesCliTransport = HermesCliTransport;
