#!/usr/bin/env node
const { checkOpenAICatalog } = require('../src/hermes-openai-access');
try {
  if (process.argv.length !== 2) {
    throw new Error('No arguments accepted');
  }
  const result = checkOpenAICatalog();
  console.log(JSON.stringify(result));
  if (result.status !== 'model-advertised') {
    process.exitCode = 1;
  }
} catch {
  console.error(
    JSON.stringify({ status: 'private-openai-configuration-unavailable', modelInvoked: false })
  );
  process.exitCode = 1;
}
