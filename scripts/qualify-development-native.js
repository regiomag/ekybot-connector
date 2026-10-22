const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DevelopmentBroker } = require('../src/development-broker');
const { openDevelopmentRuntime } = require('../src/development-runtime');
const { runSandboxed } = require('../src/development-command');

async function main() {
  const engine = process.argv[2];
  const withCommand = process.argv.includes('--command');
  if (!['codex', 'claude'].includes(engine)) {
    throw new Error('Choose one explicit engine');
  }
  const stateDir = fs.mkdtempSync('/private/tmp/ekydev-');
  const root = path.join(stateDir, 'project');
  fs.mkdirSync(root, { mode: 0o700 });
  fs.writeFileSync(path.join(root, 'fixture.txt'), 'FIXTURE_7391\n', { mode: 0o600 });
  const channelId = crypto.randomUUID(),
    events = [];
  let session;
  for (const [index, text] of [
    'Use ekybot_read to read fixture.txt. Use ekybot_edit to create answer.txt containing exactly the fixture text. ' +
      (withCommand
        ? 'Use ekybot_exec with command /usr/bin/xcodebuild and args ["-version"] to verify the Mac tools. Do not run any other command.'
        : 'Do not execute commands.') +
      ' Do not use Git or delegate. Reply DEV_FILE_OK after checking the tool results.',
    'Use ekybot_read to inspect answer.txt. State its exact content, and the fixture code you remember from the previous turn. Do not edit files or execute commands.',
  ].entries()) {
    const runId = crypto.randomUUID();
    const broker = new DevelopmentBroker({
      root,
      stateDir: path.join(stateDir, 'tools', runId),
      runId,
      role: 'developer',
      projects: [],
      ...(withCommand ? { runCommand: (options) => runSandboxed(options) } : {}),
      approve: async (request) =>
        withCommand &&
        request.tool === 'ekybot_exec' &&
        request.input.command === '/usr/bin/xcodebuild' &&
        JSON.stringify(request.input.args) === '["-version"]',
      event: async (event) => events.push(event),
    });
    const runtime = await openDevelopmentRuntime({
      stateDir,
      channelId,
      engine,
      broker,
      home: os.homedir(),
    });
    try {
      const result = await runtime.journal.run({ id: runId, channelId, text });
      if (session && result.sessionId !== session) {
        throw new Error('Native session changed');
      }
      session = result.sessionId;
      if (index === 1 && !result.output.includes('FIXTURE_7391')) {
        throw new Error('Native continuation did not recall fixture');
      }
    } finally {
      await runtime.close();
    }
  }
  if (fs.readFileSync(path.join(root, 'answer.txt'), 'utf8') !== 'FIXTURE_7391\n') {
    throw new Error('File effect did not match');
  }
  console.log(
    JSON.stringify({
      engine,
      passed: true,
      stateDir,
      session,
      toolEvents: events.map((e) => ({ tool: e.tool, status: e.status })),
    })
  );
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      qualified: false,
      code: error.code || 'DEVELOPMENT_QUALIFICATION_FAILED',
      reason: error.message,
    })
  );
  process.exitCode = 1;
});
