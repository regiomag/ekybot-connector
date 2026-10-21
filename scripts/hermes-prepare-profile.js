#!/usr/bin/env node
const {
  planFreshProfile,
  createFreshProfile,
  inspectFreshProfile,
} = require('../src/hermes-fresh-profile');

function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Hermes V2 offline provisioning: --plan | --create | --check [--root ABSOLUTE_ROOT] [--profile NAME]\nNo Hermes process, credentials, old memory or model calls. --create refuses existing profiles.'
    );
    return;
  }
  const mode = args.shift();
  if (!['--plan', '--create', '--check'].includes(mode)) {
    throw new Error('Choose --plan, --create or --check.');
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2);
    if (
      !['--root', '--profile'].includes(args[i]) ||
      options[key] ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    ) {
      throw new Error('Invalid or duplicate profile option.');
    }
    options[key] = args[i + 1];
  }
  const result =
    mode === '--create'
      ? createFreshProfile(options)
      : mode === '--check'
        ? inspectFreshProfile(options)
        : planFreshProfile(options);
  console.log(JSON.stringify({ ...result, modelInvoked: false }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(
      JSON.stringify({
        code: error.code || 'HERMES_PROFILE_FAILED',
        message: error.message,
        modelInvoked: false,
      })
    );
    process.exitCode = 1;
  }
}

module.exports = { main };
