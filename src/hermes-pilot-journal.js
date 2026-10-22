// Dedicated V2 first-turn + continuation journal. No legacy routing or secrets.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readPrivateJson, writeDurableJson, HermesResumeGuard } = require('./hermes-resume-guard');
const {
  safetyError,
  inspectHermesSession,
  assertPersistedContinuation,
} = require('./hermes-session-safety');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const NATIVE_ID = /^\d{8}_\d{6}_[a-f0-9]{6}$/;
const { telemetry } = require('./native-telemetry');
const fail = (code) =>
  safetyError(code, 'Pilot stopped safely; inspect the private journal before retrying.');

class DurableConversationJournal {
  constructor({
    stateDir,
    channelId,
    profile,
    homeRoot,
    execute,
    assertFresh,
    inspectSession,
    validSessionId,
    assertContinuation,
  }) {
    if (
      !UUID.test(channelId || '') ||
      typeof execute !== 'function' ||
      typeof assertFresh !== 'function' ||
      typeof inspectSession !== 'function' ||
      typeof validSessionId !== 'function' ||
      typeof assertContinuation !== 'function'
    ) {
      throw fail('PILOT_CONFIG_INVALID');
    }
    Object.assign(this, {
      stateDir,
      channelId,
      profile,
      homeRoot,
      execute,
      assertFresh,
      inspectSession,
      validSessionId,
      assertContinuation,
    });
    // Reuse the private-directory validator used by the strict resume path.
    new HermesResumeGuard({ stateDir }).ensureDirectory();
  }

  receiptPath(id) {
    if (!UUID.test(id || '')) {
      throw fail('PILOT_JOB_INVALID');
    }
    return path.join(this.stateDir, `${id}.json`);
  }

  binding() {
    const file = path.join(this.stateDir, 'binding.json');
    if (!fs.existsSync(file)) {
      return null;
    }
    const binding = readPrivateJson(file);
    if (
      binding.channelId !== this.channelId ||
      binding.profile !== this.profile ||
      binding.homeRoot !== this.homeRoot ||
      !this.validSessionId(binding.sessionId)
    ) {
      throw fail('PILOT_BINDING_CONFLICT');
    }
    return binding;
  }

  async run(job) {
    if (
      job?.channelId !== this.channelId ||
      typeof job.text !== 'string' ||
      !job.text.trim() ||
      job.text.length > 12000
    ) {
      throw fail('PILOT_JOB_INVALID');
    }
    const file = this.receiptPath(job.id);
    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify([job.id, job.channelId, job.text, this.profile, this.homeRoot]))
      .digest('hex');
    const replay = () => {
      if (!fs.existsSync(file)) {
        return null;
      }
      const receipt = readPrivateJson(file);
      if (receipt.fingerprint !== fingerprint) {
        throw fail('PILOT_REQUEST_CONFLICT');
      }
      if (receipt.status !== 'completed') {
        throw fail('PILOT_RECONCILIATION_REQUIRED');
      }
      if (this.binding()?.sessionId !== receipt.sessionId) {
        throw fail('PILOT_BINDING_CONFLICT');
      }
      return receipt;
    };
    const completed = replay();
    if (completed) {
      return completed;
    }
    const lockPath = path.join(this.stateDir, 'conversation.lock');
    let lock;
    try {
      lock = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw fail('PILOT_RECONCILIATION_REQUIRED');
      }
      throw error;
    }
    try {
      fs.writeFileSync(lock, job.id);
      fs.fsyncSync(lock);
    } finally {
      fs.closeSync(lock);
    }
    let started = false;
    try {
      const raced = replay();
      if (raced) {
        fs.unlinkSync(lockPath);
        return raced;
      }
      const bindingPath = path.join(this.stateDir, 'binding.json');
      const binding = this.binding();
      const inspect = (sessionId) =>
        this.inspectSession({ profile: this.profile, homeRoot: this.homeRoot, sessionId });
      const before = binding ? await inspect(binding.sessionId) : null;
      if (!binding) {
        await this.assertFresh();
      }
      const record = {
        version: 1,
        id: job.id,
        channelId: this.channelId,
        fingerprint,
        profile: this.profile,
        homeRoot: this.homeRoot,
      };
      writeDurableJson(file, { ...record, status: 'started', before });
      started = true;
      const result = await this.execute({
        input: job.text,
        sessionId: binding?.sessionId ?? null,
        jobId: job.id,
        channelId: this.channelId,
      });
      if (
        !this.validSessionId(result?.sessionId || '') ||
        typeof result.output !== 'string' ||
        !result.output.trim() ||
        result.output.length > 50000 ||
        (binding && result.sessionId !== binding.sessionId)
      ) {
        throw fail('PILOT_RESULT_UNVERIFIED');
      }
      writeDurableJson(file, {
        ...record,
        sessionId: result.sessionId,
        output: result.output,
        status: 'verifying',
        before,
      });
      const after = await inspect(result.sessionId);
      if (before) {
        this.assertContinuation(before, after);
      }
      if (!binding) {
        writeDurableJson(bindingPath, {
          channelId: this.channelId,
          profile: this.profile,
          homeRoot: this.homeRoot,
          sessionId: result.sessionId,
        });
      }
      const receipt = {
        ...record,
        sessionId: result.sessionId,
        output: result.output,
        status: 'completed',
        delivered: false,
        before,
        after,
        ...(result.telemetry ? { telemetry: telemetry(result.telemetry) } : {}),
      };
      writeDurableJson(file, receipt);
      fs.unlinkSync(lockPath);
      return receipt;
    } catch (error) {
      if (!started) {
        fs.unlinkSync(lockPath);
      }
      if (started) {
        throw fail('PILOT_RECONCILIATION_REQUIRED');
      }
      throw error;
    }
  }

  pendingDelivery() {
    return fs
      .readdirSync(this.stateDir)
      .filter((name) => UUID.test(name.slice(0, -5)) && name.endsWith('.json'))
      .map((name) => readPrivateJson(path.join(this.stateDir, name)))
      .filter((row) => row.status === 'completed' && !row.delivered)
      .map((row) => {
        if (
          row.channelId !== this.channelId ||
          row.profile !== this.profile ||
          row.homeRoot !== this.homeRoot ||
          this.binding()?.sessionId !== row.sessionId ||
          typeof row.output !== 'string' ||
          !row.output.trim()
        ) {
          throw fail('PILOT_OUTBOX_INVALID');
        }
        return row;
      });
  }

  acknowledge(receipt) {
    const file = this.receiptPath(receipt.id);
    const current = readPrivateJson(file);
    if (current.status !== 'completed' || current.fingerprint !== receipt.fingerprint) {
      throw fail('PILOT_OUTBOX_INVALID');
    }
    writeDurableJson(file, { ...current, delivered: true });
  }
}

// Preserve the qualified Hermes policy while sharing intent, locks and outbox
// with subsequent runtimes. A runtime must provide its own persistence proof.
class HermesPilotJournal extends DurableConversationJournal {
  constructor(options) {
    super({
      ...options,
      inspectSession: options.inspectSession || inspectHermesSession,
      validSessionId: (id) => typeof id === 'string' && NATIVE_ID.test(id),
      assertContinuation: assertPersistedContinuation,
    });
  }
}

// A bounded tick: scheduled by the dedicated service later. Never loops here.
async function pilotTick({ journal, machine }) {
  const deliver = async (receipt) => {
    const response = await machine({
      action: 'complete',
      runId: receipt.id,
      content: receipt.output,
      sessionId: receipt.sessionId,
      ...(receipt.telemetry ? { telemetry: receipt.telemetry } : {}),
    });
    if (response?.ok !== true) {
      throw fail('PILOT_DELIVERY_UNCONFIRMED');
    }
    journal.acknowledge(receipt);
  };
  const pending = journal.pendingDelivery();
  if (pending.length) {
    for (const receipt of pending) {
      await deliver(receipt);
    }
    return { status: 'delivered', count: pending.length };
  }
  const claim = await machine({ action: 'claim' });
  if (claim.blocked) {
    return { status: 'blocked' };
  }
  if (!claim.job) {
    return { status: 'idle' };
  }
  let receipt;
  try {
    receipt = await journal.run(claim.job);
  } catch (error) {
    // Do not convert an uncertain model attempt into a new invocation.
    if (error.code === 'PILOT_RECONCILIATION_REQUIRED') {
      await machine({ action: 'uncertain', runId: claim.job.id });
    }
    throw error;
  }
  await deliver(receipt);
  return { status: 'delivered', count: 1 };
}

module.exports = { HermesPilotJournal, DurableConversationJournal, pilotTick };
