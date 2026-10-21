// Opt-in native recipe: exactly two short subscription turns, never an API key.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const { openCodexChatConnection } = require('../src/v2-codex-connection');
const {
  CodexConversationRuntime,
  validSessionId,
  assertCodexContinuation,
} = require('../src/v2-codex-runtime');
const { DurableConversationJournal } = require('../src/hermes-pilot-journal');
const { writeDurableJson } = require('../src/hermes-resume-guard');

async function main() {
  if (process.argv[2] !== '--allow-native-model' || !path.isAbsolute(process.argv[3] || '')) {
    throw new Error(
      'Explicit native-model opt-in and a new private recipe directory are required.'
    );
  }
  const root = fs.realpathSync(process.argv[3]);
  if (fs.readdirSync(root).length || fs.statSync(root).mode & 0o077) {
    throw new Error('Recipe directory must be empty and private.');
  }
  const channelId = randomUUID();
  const nonce = `EKY-${randomBytes(6).toString('hex')}`;
  const nativeHome = os.homedir();
  const stateDir = path.join(root, 'journal');
  let before;
  let sessionId;
  for (let turn = 0; turn < 2; turn++) {
    const connection = await openCodexChatConnection({ cwd: root, home: nativeHome });
    try {
      const runtime = new CodexConversationRuntime({ ...connection, cwd: root, effort: 'low' });
      const journal = new DurableConversationJournal({
        stateDir,
        channelId,
        profile: 'codex-chat-v1',
        homeRoot: nativeHome,
        execute: (job) => runtime.execute(job),
        assertFresh: async () => {},
        inspectSession: (args) => runtime.inspectSession(args),
        validSessionId,
        assertContinuation: assertCodexContinuation,
      });
      const job = {
        id: randomUUID(),
        channelId,
        text:
          turn === 0
            ? `Retain the exact code ${nonce} for my next message. Reply only OK. Do not use tools.`
            : 'What exact code did I give you in my previous message? Reply only with the code. Do not use tools.',
      };
      const receipt = await journal.run(job);
      assert.equal(receipt.output.trim(), turn === 0 ? 'OK' : nonce);
      if (turn === 0) {
        before = receipt.after;
        sessionId = receipt.sessionId;
      } else {
        assertCodexContinuation(before, receipt.after);
        assert.equal(receipt.sessionId, sessionId);
      }
      assert.deepEqual(
        await journal.run(job),
        receipt,
        'Transport replay must not invoke Codex again'
      );
      journal.acknowledge(receipt);
      console.log(
        JSON.stringify({ turn: turn + 1, persisted: true, replayWithoutGeneration: true })
      );
    } finally {
      connection.rpc.close();
    }
  }
  writeDurableJson(path.join(root, 'qualification.json'), {
    qualified: true,
    mode: 'chat-only',
    sessionId,
    turns: 2,
    at: new Date().toISOString(),
  });
  console.log(
    JSON.stringify({ qualified: true, mode: 'chat-only', processRestart: true, turns: 2 })
  );
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      qualified: false,
      code: error.code || 'QUALIFICATION_FAILED',
      replayAllowed: false,
    })
  );
  process.exitCode = 1;
});
