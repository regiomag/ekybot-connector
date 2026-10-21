#!/usr/bin/env node
// Metadata only. Never start Hermes, load provider credentials or create state.
const { HermesResumeGuard } = require('../src/hermes-resume-guard');
const { inspectHermesSession, safetyError } = require('../src/hermes-session-safety');

const HELP = `Hermes resume preflight (read-only, no model calls)

  node scripts/hermes-resume-preflight.js --inspect-session EXACT_NATIVE_ID [--profile default]
  node scripts/hermes-resume-preflight.js --bindings /absolute/private/bindings.json --conversation EXACT_RELAY_KEY [--profile default]

A successful check confirms metadata eligibility, not semantic continuity.
It does not create a binding, journal, backup, migration or runtime process.`;

function parseArgs(args) {
  const options = {};
  const allowed = new Set(['--bindings', '--conversation', '--profile', '--inspect-session']);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (
      !allowed.has(flag) ||
      options[flag] !== undefined ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    ) {
      throw safetyError(
        'HERMES_PREFLIGHT_ARGUMENTS',
        'Invalid or duplicate preflight option. Use --help.'
      );
    }
    options[flag] = args[i + 1];
  }
  const inspectOnly = Boolean(options['--inspect-session']);
  if (
    inspectOnly
      ? options['--bindings'] || options['--conversation']
      : !options['--bindings'] || !options['--conversation']
  ) {
    throw safetyError(
      'HERMES_PREFLIGHT_ARGUMENTS',
      'Choose either exact-session inspection or a bindings/conversation check.'
    );
  }
  return options;
}

async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(HELP);
    return;
  }
  const options = parseArgs(args);
  const profile = options['--profile'] || 'default';
  const result = options['--inspect-session']
    ? { snapshot: await inspectHermesSession({ profile, sessionId: options['--inspect-session'] }) }
    : await new HermesResumeGuard({ bindingsPath: options['--bindings'] }).preflight({
        profile,
        sessionId: options['--conversation'],
      });
  console.log(
    JSON.stringify(
      { readOnly: true, modelInvoked: false, metadataEligible: true, ...result },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        readOnly: true,
        modelInvoked: false,
        metadataEligible: false,
        code: error.code || 'HERMES_PREFLIGHT_FAILED',
        message: error.message,
      })
    );
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, main };
