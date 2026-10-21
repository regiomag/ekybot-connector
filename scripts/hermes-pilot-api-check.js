#!/usr/bin/env node
const { selectAnthropicWorkspace } = require('../src/hermes-pilot-profile');
const { checkAnthropicAccess } = require('../src/hermes-anthropic-access');
try {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === '--workspace') {
    selectAnthropicWorkspace(args[1]);
  } else if (args.length) {
    throw new Error('Use no arguments, or --workspace wrkspc_…');
  }
  const result = checkAnthropicAccess();
  console.log(JSON.stringify(result));
  if (result.status !== 'model-metadata-verified') {
    process.exitCode = 1;
  }
} catch {
  console.error(
    JSON.stringify({ status: 'private-configuration-unavailable', modelInvoked: false })
  );
  process.exitCode = 1;
}
