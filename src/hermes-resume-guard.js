// Opt-in, local-owner-controlled binding + conservative durable execution gate.
// A crash or ambiguous failure never expires into an automatic model retry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  safetyError,
  normalizeProfile,
  assertSessionId,
  inspectHermesSession,
  assertPersistedContinuation,
} = require('./hermes-session-safety');

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const RUN_ID_PATTERN = /^resume_[a-f0-9]{64}$/;

function readPrivateJson(file) {
  try {
    const stat = fs.lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.mode & 0o077 ||
      (process.getuid && stat.uid !== process.getuid()) ||
      stat.size > 1024 * 1024
    ) {
      throw new Error('unsafe file');
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw safetyError(
      'HERMES_UNSAFE_STATE',
      'Hermes resume state is unreadable or unsafe; require owner-only regular JSON files.'
    );
  }
}

function readBindings(file) {
  if (!file || !path.isAbsolute(file)) {
    throw safetyError(
      'HERMES_BINDING_REQUIRED',
      'An absolute local Hermes bindings file is required.'
    );
  }
  const config = readPrivateJson(file);
  if (config.version !== 1 || !Array.isArray(config.bindings) || !config.bindings.length) {
    throw safetyError('HERMES_INVALID_BINDINGS', 'Expected a version 1 Hermes bindings document.');
  }
  const scopes = new Set();
  const sessions = new Set();
  for (const binding of config.bindings) {
    if (
      !binding ||
      typeof binding.conversationKey !== 'string' ||
      !binding.conversationKey.trim() ||
      binding.conversationKey.length > 512 ||
      binding.transport !== 'cli' ||
      typeof binding.profile !== 'string'
    ) {
      throw safetyError(
        'HERMES_INVALID_BINDINGS',
        'Each binding needs an exact conversation key, profile, CLI transport and session ID.'
      );
    }
    const profile = normalizeProfile(binding.profile);
    assertSessionId(binding.sessionId);
    const scope = JSON.stringify([profile, binding.conversationKey]);
    const session = JSON.stringify([profile, binding.sessionId]);
    if (scopes.has(scope) || sessions.has(session)) {
      throw safetyError(
        'HERMES_AMBIGUOUS_BINDING',
        'A conversation or Hermes session is bound more than once.'
      );
    }
    scopes.add(scope);
    sessions.add(session);
  }
  return config.bindings;
}

function writeDurableJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try {
    fs.fsyncSync(directory);
  } finally {
    fs.closeSync(directory);
  }
}

class HermesResumeGuard {
  constructor({ bindingsPath, stateDir, inspectSession = inspectHermesSession } = {}) {
    this.bindingsPath = bindingsPath;
    this.stateDir = stateDir;
    this.inspectSession = inspectSession;
  }

  resolveBinding(params) {
    const profile = normalizeProfile(params.profile);
    const binding = readBindings(this.bindingsPath).find(
      (b) => normalizeProfile(b.profile) === profile && b.conversationKey === params.sessionId
    );
    if (!binding) {
      throw safetyError(
        'HERMES_BINDING_REQUIRED',
        'No verified local binding for this exact profile and Ekybot conversation. No fresh session was started.'
      );
    }
    if (params.resumeSessionId && params.resumeSessionId !== binding.sessionId) {
      throw safetyError(
        'HERMES_SESSION_SCOPE',
        'A caller cannot override the locally bound Hermes session.'
      );
    }
    return { ...binding, profile };
  }

  ensureDirectory() {
    if (!this.stateDir || !path.isAbsolute(this.stateDir)) {
      throw safetyError(
        'HERMES_UNSAFE_STATE',
        'An absolute private resume journal directory is required.'
      );
    }
    fs.mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(this.stateDir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.mode & 0o077 ||
      (process.getuid && stat.uid !== process.getuid())
    ) {
      throw safetyError(
        'HERMES_UNSAFE_STATE',
        'The resume journal directory must be owner-only and not a symlink.'
      );
    }
  }

  async preflight(params) {
    const binding = this.resolveBinding(params);
    return {
      binding,
      snapshot: await this.inspectSession({
        profile: binding.profile,
        sessionId: binding.sessionId,
      }),
    };
  }

  async startRun(params, execute) {
    const binding = this.resolveBinding(params);
    if (
      typeof params.idempotencyKey !== 'string' ||
      !params.idempotencyKey.trim() ||
      params.idempotencyKey.length > 512 ||
      typeof params.input !== 'string' ||
      !params.input.trim()
    ) {
      throw safetyError(
        'HERMES_REQUEST_ID_REQUIRED',
        'Strict resume requires a nonempty input and stable request id.'
      );
    }
    // Ignore no requested system prompt silently in the strict path. Profiles
    // own their personality until a supported per-run instructions API exists.
    if (params.systemPrompt) {
      throw safetyError(
        'HERMES_INSTRUCTIONS_UNSUPPORTED',
        'CLI resume cannot safely apply per-run system instructions; use the qualified profile configuration.'
      );
    }
    this.ensureDirectory();
    const scope = [binding.profile, binding.conversationKey];
    const runId = `resume_${digest([scope, params.idempotencyKey])}`;
    const receiptPath = path.join(this.stateDir, `${runId}.json`);
    const fingerprint = digest([
      scope,
      binding.sessionId,
      params.input,
      params.systemPrompt || null,
    ]);
    const replay = () => {
      if (!fs.existsSync(receiptPath)) {
        return null;
      }
      const prior = readPrivateJson(receiptPath);
      if (prior.fingerprint !== fingerprint) {
        throw safetyError(
          'HERMES_REQUEST_CONFLICT',
          'The request id was already used with different content or a different session.'
        );
      }
      if (
        prior.runId !== runId ||
        prior.status !== 'completed' ||
        typeof prior.output !== 'string' ||
        !prior.output.trim()
      ) {
        throw safetyError(
          'HERMES_RECONCILIATION_REQUIRED',
          'A previous attempt may have executed. Inspect its journal; automatic rerun is forbidden.'
        );
      }
      return { runId, status: 'completed', replayed: true };
    };
    const prior = replay();
    if (prior) {
      return prior;
    }

    const lockPath = path.join(
      this.stateDir,
      `session_${digest([binding.profile, binding.sessionId])}.lock`
    );
    let lock;
    try {
      lock = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw safetyError(
          'HERMES_SESSION_BUSY',
          'This session is locked or awaiting reconciliation; no concurrent resume is allowed.'
        );
      }
      throw error;
    }
    try {
      fs.writeFileSync(lock, runId);
      fs.fsyncSync(lock);
    } finally {
      fs.closeSync(lock);
    }
    let started = false;
    const record = {
      version: 1,
      runId,
      fingerprint,
      profile: binding.profile,
      conversationKey: binding.conversationKey,
      sessionId: binding.sessionId,
    };
    try {
      // Another process may have completed between the first receipt check
      // and exclusive acquisition. Check again while owning the session lock.
      const completed = replay();
      if (completed) {
        fs.unlinkSync(lockPath);
        return completed;
      }
      const before = await this.inspectSession({
        profile: binding.profile,
        sessionId: binding.sessionId,
      });
      // Persist intent before invoking anything that could call a model.
      writeDurableJson(receiptPath, { ...record, status: 'started', before });
      started = true;
      const result = await execute({
        ...params,
        profile: binding.profile,
        resumeSessionId: binding.sessionId,
      });
      if (
        result?.status !== 'completed' ||
        typeof result.output !== 'string' ||
        !result.output.trim() ||
        result.output.length > 100000
      ) {
        throw safetyError(
          'HERMES_CONTINUITY_UNVERIFIED',
          'The runtime did not produce a verified completed response.'
        );
      }
      // Keep provisional output for manual reconciliation; never replay it as
      // completed until persistence in the bound session has been checked.
      writeDurableJson(receiptPath, {
        ...record,
        status: 'verifying',
        output: result.output,
        before,
      });
      const after = await this.inspectSession({
        profile: binding.profile,
        sessionId: binding.sessionId,
      });
      assertPersistedContinuation(before, after);
      writeDurableJson(receiptPath, {
        ...record,
        status: 'completed',
        output: result.output,
        before,
        after,
      });
      fs.unlinkSync(lockPath);
      return { runId, status: 'completed' };
    } catch (error) {
      if (!started) {
        // No runtime invocation occurred. A metadata/configuration repair may
        // be retried safely. Once intent exists, retain the lock indefinitely.
        fs.unlinkSync(lockPath);
        throw error;
      }
      throw safetyError(
        'HERMES_RECONCILIATION_REQUIRED',
        'Hermes may have run, but completion was not safely verified. Keep the lock and inspect the durable receipt before any retry.'
      );
    }
  }

  getRun({ profile, runId }) {
    if (!RUN_ID_PATTERN.test(runId || '')) {
      throw safetyError('HERMES_INVALID_RUN', 'Invalid strict resume run id.');
    }
    this.ensureDirectory();
    const record = readPrivateJson(path.join(this.stateDir, `${runId}.json`));
    if (record.profile !== normalizeProfile(profile) || record.runId !== runId) {
      throw safetyError('HERMES_SESSION_SCOPE', 'The persisted run belongs to another profile.');
    }
    // Revoked/rebound configurations cannot be bypassed by reading old runs.
    const binding = this.resolveBinding({ profile, sessionId: record.conversationKey });
    if (binding.sessionId !== record.sessionId || record.status !== 'completed') {
      throw safetyError(
        'HERMES_RECONCILIATION_REQUIRED',
        'The run is not a completed result for the current binding.'
      );
    }
    return { runId, status: 'completed', output: record.output, usage: undefined };
  }
}

module.exports = { HermesResumeGuard, readBindings, RUN_ID_PATTERN };
