const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const {
  ClaudeConversationRuntime,
  POLICY,
  assertClaudeContinuation,
} = require('../src/v2-claude-runtime');
const { validSessionId } = require('../src/v2-codex-runtime');
const { DurableConversationJournal } = require('../src/hermes-pilot-journal');
const { writeDurableJson } = require('../src/hermes-resume-guard');

async function main() {
  if (process.argv[2] !== '--allow-native-model' || !path.isAbsolute(process.argv[3] || '')) {
    throw new Error('Explicit model opt-in required');
  }
  const root = fs.realpathSync(process.argv[3]);
  if (fs.readdirSync(root).length || fs.statSync(root).mode & 0o077) {
    throw new Error('Empty private directory required');
  }
  const channelId = randomUUID(),
    nonce = `EKY-${randomBytes(6).toString('hex')}`,
    home = os.homedir();
  let sessionId;
  for (let turn = 0; turn < 2; turn++) {
    const runtime = new ClaudeConversationRuntime({ cwd: root, home });
    const journal = new DurableConversationJournal({
      stateDir: path.join(root, 'journal'),
      channelId,
      profile: POLICY,
      homeRoot: home,
      assertFresh: async () => {},
      validSessionId,
      assertContinuation: assertClaudeContinuation,
      inspectSession: (args) => runtime.inspectSession(args),
      execute: (args) => runtime.execute(args),
    });
    const job = {
      id: randomUUID(),
      channelId,
      text:
        turn === 0
          ? `Retain the exact code ${nonce} for my next message. Reply only OK.`
          : 'What exact code did I give you in my previous message? Reply only with the code.',
    };
    const receipt = await journal.run(job);
    assert.equal(receipt.output.trim(), turn === 0 ? 'OK' : nonce);
    if (sessionId) {
      assert.equal(receipt.sessionId, sessionId);
    }
    sessionId = receipt.sessionId;
    assert.deepEqual(await journal.run(job), receipt);
    journal.acknowledge(receipt);
    console.log(JSON.stringify({ turn: turn + 1, persisted: true, replayWithoutGeneration: true }));
  }
  writeDurableJson(path.join(root, 'qualification.json'), {
    qualified: true,
    policy: POLICY,
    sessionId,
    turns: 2,
    at: new Date().toISOString(),
  });
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
