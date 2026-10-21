#!/usr/bin/env node
const { configurePilotProfile, importAnthropicKey } = require('../src/hermes-pilot-profile');
try {
  const args = process.argv.slice(2);
  let result;
  if (args.length === 1 && args[0] === '--configure') {
    result = configurePilotProfile();
  } else if (args.length === 2 && args[0] === '--import-anthropic-key') {
    result = importAnthropicKey(args[1]);
  } else {
    throw new Error('Use --configure or --import-anthropic-key /absolute/authorized/source.env.');
  }
  console.log(JSON.stringify(result));
} catch (error) {
  // Parser and filesystem exceptions must never echo credential contents.
  console.error(
    JSON.stringify({
      status: 'configuration-failed',
      code: error.code || 'INVALID_INPUT',
      modelInvoked: false,
    })
  );
  process.exitCode = 1;
}
