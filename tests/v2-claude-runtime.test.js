const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const {
  ClaudeConversationRuntime,
  claudeArguments,
  assertInitialization,
  transcriptPath,
  assertClaudeContinuation,
  readTranscript,
} = require('../src/v2-claude-runtime');

test('Claude native invocation disables tools, inherited settings and API credentials', () => {
  const id = randomUUID(),
    args = claudeArguments({ sessionId: id, resume: true });
  for (const flag of ['--safe-mode', '--restricted', '--strict-mcp-config', '--no-chrome']) {
    assert.ok(args.includes(flag));
  }
  assert.ok(!args.includes('--bare'), 'Bare mode disables subscription authentication');
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--resume') + 1], id);
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.throws(() => claudeArguments({ sessionId: 'latest' }));
});

function fakeProcess(events, code = 0, splitBytes = false) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      queueMicrotask(() => child.emit('close', null));
    };
    child.stdin = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
      final(done) {
        queueMicrotask(() => {
          for (const event of events) {
            const line = Buffer.from(JSON.stringify(event) + '\n');
            if (splitBytes) {
              for (const byte of line) {
                child.stdout.write(Buffer.from([byte]));
              }
            } else {
              child.stdout.write(line);
            }
          }
          child.emit('close', code);
        });
        done();
      },
    });
    return child;
  };
}

test('Claude stream requires exact input acknowledgement, successful result and no tools', async () => {
  const sessionId = randomUUID(),
    jobId = randomUUID(),
    cwd = '/private/tmp/fixture';
  const init = {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    cwd,
    claude_code_version: '2.1.285',
    permissionMode: 'dontAsk',
    apiKeySource: 'none',
    tools: [],
    mcp_servers: [],
    plugins: [],
    skills: [],
    slash_commands: [],
  };
  const input = 'Bonjour éà漢😀';
  const user = { type: 'user', uuid: jobId, session_id: sessionId, message: { content: input } };
  const result = {
    type: 'result',
    subtype: 'success',
    session_id: sessionId,
    user_message_uuid: jobId,
    num_turns: 1,
    is_error: false,
    permission_denials: [],
    result: 'hi',
  };
  const run = (events, code = 0, splitBytes = false) =>
    new ClaudeConversationRuntime({
      cwd,
      home: '/private/tmp/fixture-home',
      spawnImpl: fakeProcess(events, code, splitBytes),
    }).run({ input, jobId, sessionId, resume: false });
  assert.equal(await run([init, user, result]), 'hi');
  assert.equal(
    await run([init, user, result], 0, true),
    'hi',
    'UTF-8 split across arbitrary pipe chunks preserves the exact acknowledgement'
  );
  const anchor = randomUUID(),
    boundaryId = randomUUID();
  const boundary = {
    type: 'system',
    subtype: 'compact_boundary',
    session_id: sessionId,
    uuid: boundaryId,
    logical_parent_uuid: randomUUID(),
    compact_metadata: {
      trigger: 'auto',
      pre_tokens: 17000,
      post_tokens: 3000,
      preserved_messages: { anchor_uuid: anchor },
    },
  };
  const summary = {
    type: 'user',
    session_id: sessionId,
    uuid: anchor,
    isSynthetic: true,
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'text', text: 'Native summary' }] },
  };
  const compactRun = new ClaudeConversationRuntime({
    cwd,
    home: '/private/tmp/fixture-home',
    spawnImpl: fakeProcess([
      init,
      { type: 'system', subtype: 'status', status: 'compacting', session_id: sessionId },
      user,
      boundary,
      summary,
      result,
    ]),
  });
  assert.equal(await compactRun.run({ input, jobId, sessionId, resume: true }), 'hi');
  assert.equal(compactRun.metrics.compactions, 1);
  for (const bad of [
    [init, user, summary, result],
    [init, user, boundary, result],
    [init, user, boundary, { ...summary, uuid: randomUUID() }, result],
    [init, user, boundary, summary, summary, result],
    [init, user, { ...boundary, compact_metadata: {} }, summary, result],
  ]) {
    await assert.rejects(run(bad));
  }
  for (const events of [
    [init, result],
    [init, user],
    [init, { ...user, uuid: randomUUID() }, result],
    [init, user, { ...result, is_error: true }],
    [init, user, { ...result, num_turns: 2 }],
    [{ ...init, tools: ['Bash'] }, user, result],
    [init, user, { type: 'control_request' }, result],
  ]) {
    await assert.rejects(run(events));
  }
  await assert.rejects(run([init, user, result], 1));
});

test('Claude effective initialization rejects inherited tools and non-subscription API source', () => {
  const id = randomUUID(),
    cwd = '/private/tmp/fixture';
  const event = {
    session_id: id,
    cwd,
    claude_code_version: '2.1.285',
    permissionMode: 'dontAsk',
    apiKeySource: 'none',
    tools: [],
    mcp_servers: [],
    plugins: [],
    skills: [],
    slash_commands: [],
  };
  assert.doesNotThrow(() => assertInitialization(event, cwd, id));
  for (const change of [
    { tools: ['Read'] },
    { plugins: [{ name: 'other' }] },
    { apiKeySource: 'env' },
    { cwd: '/elsewhere' },
    { claude_code_version: 'changed' },
  ]) {
    assert.throws(() => assertInitialization({ ...event, ...change }, cwd, id));
  }
});

test('Claude persistence is scoped to the exact project and refuses rewrites or wrong sessions', (t) => {
  const root = fs.mkdtempSync('/private/tmp/ekybot-claude-test.');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'workspace');
  fs.mkdirSync(cwd, { mode: 0o700 });
  const id = randomUUID(),
    file = transcriptPath(root, cwd, id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const rows = ['user', 'assistant'].map((type) => ({
    type,
    uuid: randomUUID(),
    cwd,
    sessionId: id,
    isSidechain: false,
    version: '2.1.285',
    message: {
      role: type,
      content: type === 'user' ? 'hello' : [{ type: 'text', text: 'hi' }],
      ...(type === 'assistant' ? { stop_reason: 'end_turn' } : {}),
    },
  }));
  fs.writeFileSync(file, rows.map(JSON.stringify).join('\n') + '\n', { mode: 0o600 });
  const runtime = new ClaudeConversationRuntime({ cwd, home: root });
  const before = runtime.inspectSession({ sessionId: id });
  fs.appendFileSync(
    file,
    rows.map((row) => JSON.stringify({ ...row, uuid: randomUUID() })).join('\n') + '\n'
  );
  const after = runtime.inspectSession({ sessionId: id });
  assert.doesNotThrow(() => assertClaudeContinuation(before, after));
  assert.throws(() => assertClaudeContinuation(before, { ...after, sessionId: randomUUID() }));
  assert.throws(() =>
    assertClaudeContinuation(before, { ...after, messages: after.messages.slice(1) })
  );
  assert.throws(() => runtime.inspectSession({ sessionId: randomUUID() }));
  const boundaryId = randomUUID(),
    summaryId = randomUUID();
  const boundary = {
    type: 'system',
    subtype: 'compact_boundary',
    uuid: boundaryId,
    logicalParentUuid: rows[1].uuid,
    sessionId: id,
    cwd,
    version: '2.1.285',
    isSidechain: false,
    compactMetadata: {
      trigger: 'auto',
      preTokens: 17000,
      postTokens: 3000,
      preservedMessages: { anchorUuid: summaryId },
    },
  };
  const summary = {
    ...rows[0],
    uuid: summaryId,
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
    message: { role: 'user', content: 'Synthetic native summary' },
  };
  fs.appendFileSync(
    file,
    [boundary, summary, ...rows.map((row) => ({ ...row, uuid: randomUUID() }))]
      .map(JSON.stringify)
      .join('\n') + '\n'
  );
  const compacted = runtime.inspectSession({ sessionId: id });
  assert.equal(compacted.users, after.users + 1);
  assert.equal(compacted.boundaries.length, 1);
  assert.doesNotThrow(() => assertClaudeContinuation(after, compacted));
  assert.throws(() =>
    assertClaudeContinuation(
      { ...compacted, messages: compacted.messages.slice(0, -1) },
      {
        ...compacted,
        boundaries: [{ ...compacted.boundaries[0], hash: 'tampered' }],
        users: compacted.users + 1,
      }
    )
  );
  const valid = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(
    file,
    valid.replace(
      JSON.stringify(summary),
      JSON.stringify({
        ...summary,
        message: {
          role: 'user',
          content: [{ type: 'tool_use', id: 'injected', name: 'file', input: {} }],
        },
      })
    )
  );
  assert.throws(() => readTranscript(root, cwd, id, true), 'A summary cannot carry tool calls');
  fs.writeFileSync(file, valid);
  fs.appendFileSync(file, JSON.stringify({ ...summary, uuid: randomUUID() }) + '\n');
  assert.throws(() => readTranscript(root, cwd, id), 'Unbound summaries must fail closed');
});
