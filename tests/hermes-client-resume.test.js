const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { executeHermes } = require('../src/hermes-client');

const sessionId = '20261021_120000_abcdef';
function subprocess({ code = 0, output = 'Fake answer', timeout = false } = {}) {
  const calls = [];
  const spawn = (...args) => {
    calls.push(args);
    const process = new EventEmitter();
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    process.kill = () => {
      process.killed = true;
      queueMicrotask(() => process.emit('close', null));
    };
    queueMicrotask(() => {
      if (output) {
        process.stdout.emit('data', Buffer.from(output));
      }
      if (!timeout) {
        process.emit('close', code);
      }
    });
    return process;
  };
  return { calls, spawn, inspectSession: async () => ({}) };
}

describe('strict Hermes CLI invocation', () => {
  it('passes the exact native id with --resume and no cwd restoration', async () => {
    const fake = subprocess();
    const answer = await executeHermes(
      'A synthetic prompt',
      { profile: 'research', resumeSessionId: sessionId },
      fake
    );
    assert.equal(answer.content, 'Fake answer');
    assert.deepEqual(fake.calls[0][1], [
      'chat',
      '-q',
      'A synthetic prompt',
      '--quiet',
      '--resume',
      sessionId,
      '--no-restore-cwd',
    ]);
    assert.match(fake.calls[0][2].env.HERMES_HOME, /profiles\/research$/);
    assert.equal(fake.calls[0][2].shell, undefined);
  });
  it('does not spawn when exact-session validation fails', async () => {
    const fake = subprocess();
    fake.inspectSession = async () => {
      throw new Error('Session unavailable');
    };
    await assert.rejects(
      executeHermes('test', { resumeSessionId: sessionId }, fake),
      /Session unavailable/
    );
    assert.equal(fake.calls.length, 0);
  });
  it('does not interpret a relay key as a native session', async () => {
    const fake = subprocess();
    await assert.rejects(executeHermes('test', { resumeSessionId: 'agent:a:ekybot:chat' }, fake), {
      code: 'HERMES_INVALID_SESSION',
    });
    assert.equal(fake.calls.length, 0);
  });
  it('rejects nonzero exit even if stdout contains a plausible answer', async () => {
    await assert.rejects(
      executeHermes('test', { resumeSessionId: sessionId }, subprocess({ code: 1 })),
      { code: 'HERMES_RESUME_UNCERTAIN' }
    );
  });
  it('rejects blank successful stdout', async () => {
    await assert.rejects(
      executeHermes('test', { resumeSessionId: sessionId }, subprocess({ output: '' })),
      { code: 'HERMES_RESUME_UNCERTAIN' }
    );
  });
  it('rejects timeout with partial stdout rather than marking it completed', async () => {
    await assert.rejects(
      executeHermes(
        'test',
        { resumeSessionId: sessionId, timeoutMs: 5 },
        subprocess({ timeout: true })
      ),
      { code: 'HERMES_RESUME_UNCERTAIN' }
    );
  });
  it('does not silently ignore requested instructions during resume', async () => {
    const fake = subprocess();
    await assert.rejects(
      executeHermes('test', { resumeSessionId: sessionId, systemPrompt: 'instruction' }, fake),
      { code: 'HERMES_INSTRUCTIONS_UNSUPPORTED' }
    );
    assert.equal(fake.calls.length, 0);
  });
  it('preserves the existing unconfigured one-shot path', async () => {
    const fake = subprocess();
    await executeHermes('test', {}, fake);
    assert.deepEqual(fake.calls[0][1], ['chat', '-q', 'test', '--quiet']);
  });
});
