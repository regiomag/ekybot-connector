// Explicit live qualification: synthetic input, no BMT credential or API access.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { openBmtRuntime } = require('../src/bmt-runtime');
async function main() {
  const engine = process.argv[2];
  if (!['hermes', 'claude', 'codex'].includes(engine)) {
    throw new Error('Choose one engine');
  }
  const stateDir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), `ekybot-bmt-${engine}-qualification-`)
  );
  const chatId = crypto.randomUUID(),
    agent = { id: crypto.randomUUID(), engine };
  const runtime = await openBmtRuntime({ stateDir, chatId, agent });
  try {
    const first = await runtime.journal.run({
      id: crypto.randomUUID(),
      channelId: chatId,
      text: 'Qualification BMT synthétique. Aucune donnée métier ni clé. Réponds uniquement avec ce JSON : {"type":"answer","text":"BMT_NATIVE_OK"}. Mémorise le code de test FICTION_728 dans cette conversation uniquement.',
    });
    runtime.journal.acknowledge(first);
    const second = await runtime.journal.run({
      id: crypto.randomUUID(),
      channelId: chatId,
      text: 'Qualification BMT : restitue le code de test du message précédent dans ce format JSON exact : {"type":"answer","text":"le code"}. Aucun outil.',
    });
    runtime.journal.acknowledge(second);
    const a = JSON.parse(first.output),
      b = JSON.parse(second.output);
    if (
      a.type !== 'answer' ||
      !b.text.includes('FICTION_728') ||
      first.sessionId !== second.sessionId
    ) {
      throw new Error('Unqualified native response');
    }
    process.stdout.write(
      JSON.stringify({
        engine,
        passed: true,
        sameSession: true,
        steps: 2,
        bmtApiCalls: 0,
        stateDir,
      }) + '\n'
    );
  } finally {
    runtime.close();
  }
}
main().catch((e) => {
  process.stderr.write(
    JSON.stringify({ passed: false, error: e.code || 'NATIVE_QUALIFICATION_FAILED' }) + '\n'
  );
  process.exitCode = 1;
});
