// Bounded real-engine qualification. Threshold overrides are local to these
// synthetic child processes, never persisted in production configuration.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { DevelopmentBroker } = require('../src/development-broker');
const { openDevelopmentRuntime } = require('../src/development-runtime');
const { projectNotebook } = require('../src/project-notebook');
const { ClaudeConversationRuntime } = require('../src/v2-claude-runtime');
const { openCodexChatConnection } = require('../src/v2-codex-connection');
const { JsonRpcProcess } = require('../src/v2-json-rpc');
const { createNativeConversationJournal } = require('../src/native-conversation');
async function main() {
  const engine = process.argv[2];
  assert.ok(['claude', 'codex'].includes(engine));
  const stateDir = fs.mkdtempSync('/private/tmp/ekybot-long-');
  const root = path.join(stateDir, 'project');
  fs.mkdirSync(root, { mode: 0o700 });
  fs.writeFileSync(path.join(root, 'check.txt'), 'FILE_CHECK_8376\n', { mode: 0o600 });
  const channelId = randomUUID(),
    events = [],
    results = [];
  let session, lastJob;
  console.log(JSON.stringify({ engine, stateDir, channelId }));
  for (let index = 0; index < 4; index++) {
    const padding = Array.from(
      { length: 130 },
      (_, n) => `fixture_${n}: ${createHash('sha256').update(`${index}:${n}`).digest('hex')}`
    ).join('\n');
    const text =
      index === 0
        ? `Remember ANCHOR_67542 and the rule NEVER_CHANGE_FILES for later. Ignore these synthetic records, do not repeat them. Reply ANCHOR_SAVED.\n${padding}`
        : index === 3
          ? 'Report the initial anchor and initial rule from memory. Also read check.txt using ekybot_read and search the notebook using ekybot_memory_search. Report their codes. No edits, commands or Git.'
          : `Keep the initial anchor and rule. Ignore these synthetic records and reply CONTINUE_OK.\n${padding}`;
    const job = { id: randomUUID(), channelId, text };
    lastJob = job;
    const broker = new DevelopmentBroker({
      root,
      stateDir: path.join(stateDir, 'tools', job.id),
      runId: job.id,
      role: 'developer',
      projects: [],
      grants: { write: false, git: false, exec: false },
      approve: async () => false,
      event: async (e) => events.push(e),
      ...projectNotebook(async (op) => {
        assert.equal(op, 'search');
        return {
          notes: [
            {
              id: randomUUID(),
              revision: 1,
              status: 'approved',
              body: 'NOTE_CHECK_9458',
              source: 'Synthetic qualification',
            },
          ],
        };
      }),
    });
    const runtime = await openDevelopmentRuntime({
      stateDir,
      channelId,
      engine,
      broker,
      model: engine === 'codex' ? 'gpt-5.6-sol' : 'opus',
      connectCodex: (options) =>
        openCodexChatConnection({
          ...options,
          createRpc: (options) =>
            new JsonRpcProcess({
              ...options,
              args: [...options.args, '-c', 'model_auto_compact_token_limit=12000'],
            }),
        }),
      createClaude: (options) =>
        new ClaudeConversationRuntime({
          ...options,
          spawnImpl: (command, args, options) =>
            spawn(command, args, {
              ...options,
              env: {
                ...options.env,
                CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '1',
                CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000',
              },
            }),
        }),
    });
    try {
      const result = await runtime.journal.run(job);
      if (session) {
        assert.equal(result.sessionId, session);
      }
      session = result.sessionId;
      results.push({ index, session, output: result.output, telemetry: result.telemetry });
      console.log(JSON.stringify(results.at(-1)));
      if (index === 3) {
        for (const marker of [
          'ANCHOR_67542',
          'NEVER_CHANGE_FILES',
          'FILE_CHECK_8376',
          'NOTE_CHECK_9458',
        ]) {
          assert.ok(result.output.includes(marker), `Missing ${marker}`);
        }
      }
    } finally {
      await runtime.close();
    }
  }
  assert.ok(
    results.some((r) => r.telemetry?.compactions > 0),
    'No native compaction observed'
  );
  for (const tool of ['ekybot_read', 'ekybot_memory_search']) {
    assert.ok(events.some((e) => e.tool === tool && e.status === 'completed'));
  }
  // A restart with a lost delivery acknowledgement reuses the completed receipt
  // even when provider authentication is unavailable. No native process opens.
  const journal = createNativeConversationJournal({
    engine,
    stateDir: path.join(stateDir, 'sessions', channelId, engine, 'journal'),
    channelId,
    profile: `development-${engine}-v1`,
    homeRoot: os.homedir(),
    getRuntime: () => {
      throw new Error('Must not regenerate');
    },
  });
  const replay = await journal.run(lastJob);
  assert.equal(replay.sessionId, session);
  assert.equal(replay.output, results.at(-1).output);
  fs.writeFileSync(
    path.join(stateDir, 'qualification.json'),
    JSON.stringify({
      engine,
      session,
      results,
      tools: events.map((e) => ({ tool: e.tool, status: e.status })),
      deliveryReplay: true,
    }),
    { mode: 0o600 }
  );
  console.log(JSON.stringify({ passed: true, engine, stateDir, session, deliveryReplay: true }));
}
main().catch((e) => {
  console.error(e.code || e.message);
  process.exitCode = 1;
});
