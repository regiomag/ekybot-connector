#!/usr/bin/env node
// Explicit bounded local recipe. A stable UUID is required for safe replay.
const fs = require('node:fs');
const { createPilotJournal } = require('../src/hermes-pilot-executor');
(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const journal = createPilotJournal();
  const receipt = await journal.run(input);
  console.log(
    JSON.stringify({
      status: receipt.status,
      id: receipt.id,
      sessionId: receipt.sessionId,
      output: receipt.output,
      messages: receipt.after.activeMessages,
    })
  );
})().catch((error) => {
  console.error(JSON.stringify({ status: 'stopped-safely', code: error.code || 'PILOT_FAILED' }));
  process.exitCode = 1;
});
