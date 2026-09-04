/**
 * RuntimeAdapter — the contract every execution runtime implements.
 *
 * Network calls: NONE (type definitions only).
 *
 * Ekybot stays the control plane; a RuntimeAdapter is the boundary behind
 * which a runtime (Hermes, OpenClaw, Claude Code, Codex) is driven. The relay
 * is written against this contract, not against any one runtime.
 *
 * Implementations:
 *   hermes-adapter.js    — Hermes, with HTTP and CLI transports
 *   (openclaw-adapter.js — to be extracted from the existing gateway client)
 *
 * @typedef {object} RunHandle
 * @property {string} runId
 * @property {string} status - 'started' | 'completed' | 'failed' | 'cancelled' | 'stopping'
 * @property {boolean} [replayed] - true when an idempotency key returned an existing run
 *
 * @typedef {object} RunStatus
 * @property {string} runId
 * @property {string} status
 * @property {string} [output]
 * @property {{input_tokens?: number, output_tokens?: number, total_tokens?: number}} [usage]
 *
 * @typedef {object} RuntimeHealth
 * @property {string} runtime
 * @property {boolean} healthy
 *
 * @typedef {object} RuntimeInventory
 * @property {string} runtime
 * @property {boolean} healthy
 * @property {Record<string, boolean>} capabilities
 * @property {string} [transport]
 *
 * @typedef {object} StartRunInput
 * @property {string} [profile] - Runtime profile / agent identifier.
 * @property {string} input
 * @property {string} [sessionId] - Stable per-channel scope.
 * @property {string} [idempotencyKey] - A retry with the same key must not run twice.
 *
 * @typedef {object} RuntimeAdapter
 * @property {(input: StartRunInput) => Promise<RunHandle>} startRun
 * @property {(params: {profile?: string, runId: string}) => Promise<RunStatus>} getRun
 * @property {(params: {profile?: string, runId: string}) => Promise<RunHandle>} stopRun
 * @property {(params?: object) => Promise<RuntimeInventory>} discover
 * @property {(params?: object) => Promise<RuntimeHealth>} health
 *
 * Invariants expected of every implementation:
 *
 *   - `discover()` returns no configuration value (no base URL, no key, no
 *     filesystem path): its result is uploaded to Ekybot as inventory.
 *   - Identifiers that reach a filesystem path or a URL are validated before
 *     any I/O, not after.
 *   - An unresolvable target fails loudly rather than falling back to a
 *     default, so a run never executes against the wrong agent's state.
 *   - No LLM provider key transits through the adapter: each runtime
 *     authenticates to its provider locally (plan §3.1).
 */

const RUN_STATUS = Object.freeze({
  STARTED: 'started',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  STOPPING: 'stopping',
});

// A runtime profile name reaches both a filesystem path
// (~/.hermes/profiles/<name>, via HERMES_HOME) and a URL. It arrives from the
// control plane, so it is not attacker-controlled in the usual sense — but it
// crosses a trust boundary and lands in path.join(), where '../..' escapes.
// Validate once, here, rather than in each transport.
const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_PROFILE_LENGTH = 64;

/**
 * Throws unless `profile` is a safe profile name.
 * `null`, `undefined` and 'default' mean "the default profile" and are allowed.
 */
function assertValidProfile(profile) {
  if (profile === undefined || profile === null || profile === 'default') {
    return;
  }
  if (
    typeof profile !== 'string' ||
    profile.length > MAX_PROFILE_LENGTH ||
    !PROFILE_PATTERN.test(profile)
  ) {
    throw new Error(`Invalid Hermes profile: ${JSON.stringify(profile)}`);
  }
}

module.exports = { RUN_STATUS, assertValidProfile, PROFILE_PATTERN, MAX_PROFILE_LENGTH };
