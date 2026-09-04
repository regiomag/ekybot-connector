/**
 * Hermes runtime — CLI transport
 *
 * Wraps the existing `hermes chat -q` subprocess execution (hermes-client.js)
 * behind the same RuntimeAdapter contract as the HTTP transport, so the rest
 * of the Companion can be written against one interface while the migration
 * to the Runs API happens underneath.
 *
 * Network calls: NONE (local subprocess only — Hermes calls its provider
 * internally). Profile isolation is by HERMES_HOME, handled by hermes-client.
 *
 * ── Deliberate limitations (this transport is a migration stopgap) ──────────
 *
 * The CLI has no run lifecycle: `hermes chat -q` blocks until the answer is
 * complete. Consequences, all intentional and all absent from the HTTP
 * transport:
 *
 *   - `startRun` is synchronous. It returns only once the run is terminal,
 *     with status 'completed'. There is no 'started' state to observe.
 *   - `stopRun` cannot cancel anything: by the time a caller could hold a
 *     runId, the process has already exited.
 *   - Idempotency is in-memory and therefore NOT durable: it is lost when the
 *     daemon restarts, where the Runs API replays a key for 24h across
 *     gateway restarts (plan §5.2).
 *   - Only successful runs reserve an idempotency key. A failed run leaves the
 *     key free so a retry re-executes, rather than caching a transient failure
 *     forever — this matches the relay's current retry behaviour.
 *
 * Per plan §13.2 this transport is acceptable until the end of Phase 2 and
 * forbidden in Phase 3 for any new agent.
 *
 * NOTE (behaviour preserved on purpose): `executeHermes` accepts a
 * `systemPrompt` option and never applies it — the CLI args are
 * ['chat', '-q', message, '--quiet']. Hermes agents therefore run without
 * their configured personality. This transport forwards the option unchanged
 * rather than fixing it, because the extraction must not alter behaviour.
 * Reported to the decider; fix belongs in its own change.
 */

const crypto = require('crypto');

// `hermes-client` is required lazily, not at module load: it pulls in the
// subprocess stack and its dependencies. A caller that injects `execute` and
// `healthCheck` (tests, or a future transport) never needs it.
const DEFAULT_MAX_TRACKED_RUNS = 200;

class HermesCliTransport {
  /**
   * @param {object} options
   * @param {Function} [options.execute] - Injected executeHermes (no subprocess in tests).
   * @param {Function} [options.healthCheck] - Injected healthCheck.
   * @param {number} [options.maxTrackedRuns] - Bound on the in-memory run store.
   */
  constructor(options = {}) {
    const {
      execute = null,
      healthCheck = null,
      maxTrackedRuns = DEFAULT_MAX_TRACKED_RUNS,
    } = options;

    this.execute = execute;
    this.healthCheckImpl = healthCheck;
    this.maxTrackedRuns = maxTrackedRuns;

    /** @type {Map<string, object>} runId -> run record */
    this.runs = new Map();
    /** @type {Map<string, string>} idempotencyKey -> runId (successful runs only) */
    this.idempotency = new Map();
  }

  /**
   * Execute a prompt. Blocks until the run is terminal.
   * @returns {Promise<{runId: string, status: 'completed'}>}
   */
  async startRun({ profile, input, sessionId, idempotencyKey, timeoutMs, systemPrompt } = {}) {
    if (idempotencyKey) {
      const existingRunId = this.idempotency.get(idempotencyKey);
      if (existingRunId) {
        const existing = this.runs.get(existingRunId);
        if (existing) {
          return { runId: existing.runId, status: existing.status, replayed: true };
        }
      }
    }

    const runId = `cli_${crypto.randomUUID()}`;

    // Options forwarded exactly as hermes-client expects them today.
    const result = await this.resolveExecute()(input, {
      profile: profile ?? null,
      systemPrompt,
      ...(timeoutMs ? { timeoutMs } : {}),
    });

    this.trackRun({
      runId,
      status: 'completed',
      output: result?.content,
      model: result?.model,
      billingType: result?.billingType,
      exitCode: result?.exitCode,
      profile: profile ?? null,
      sessionId: sessionId ?? null,
    });

    if (idempotencyKey) {
      this.idempotency.set(idempotencyKey, runId);
    }

    return { runId, status: 'completed' };
  }

  async getRun({ runId } = {}) {
    const run = this.requireRun(runId);
    return {
      runId: run.runId,
      status: run.status,
      output: run.output,
      usage: run.usage,
    };
  }

  /**
   * The CLI has no cancellation: the process has already exited by the time a
   * caller holds a runId. Reports the terminal status instead of pretending.
   */
  async stopRun({ runId } = {}) {
    const run = this.requireRun(runId);
    return { runId: run.runId, status: run.status, stopSupported: false };
  }

  /** Lazily resolve the real CLI client, so injected callers never load it. */
  resolveExecute() {
    if (!this.execute) {
      this.execute = require('./hermes-client').executeHermes;
    }
    return this.execute;
  }

  resolveHealthCheck() {
    if (!this.healthCheckImpl) {
      this.healthCheckImpl = require('./hermes-client').healthCheck;
    }
    return this.healthCheckImpl;
  }

  async discover() {
    const health = await this.resolveHealthCheck()();
    return {
      runtime: 'hermes',
      healthy: Boolean(health?.available),
      capabilities: {
        run_submission: true,
        run_stop: false,
        run_events: false,
        run_approval: false,
        durable_idempotency: false,
      },
    };
  }

  async health() {
    const { healthy } = await this.discover();
    return { runtime: 'hermes', healthy };
  }

  requireRun(runId) {
    const run = runId ? this.runs.get(runId) : null;
    if (!run) {
      throw new Error(`Unknown Hermes run: ${JSON.stringify(runId)}`);
    }
    return run;
  }

  /** Bounded store: evict the oldest entry once the cap is reached. */
  trackRun(record) {
    if (this.runs.size >= this.maxTrackedRuns) {
      const oldest = this.runs.keys().next().value;
      if (oldest !== undefined) {
        this.runs.delete(oldest);
        for (const [key, value] of this.idempotency) {
          if (value === oldest) {
            this.idempotency.delete(key);
          }
        }
      }
    }
    this.runs.set(record.runId, record);
  }
}

module.exports = HermesCliTransport;
module.exports.HermesCliTransport = HermesCliTransport;
