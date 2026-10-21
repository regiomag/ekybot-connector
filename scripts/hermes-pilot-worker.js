#!/usr/bin/env node
// launchd schedules one bounded tick; this process never polls in a loop.
require('../src/hermes-pilot-machine')
  .runMachineTick()
  .then((result) => {
    console.log(JSON.stringify({ ...result, at: new Date().toISOString() }));
  })
  .catch((error) => {
    console.error(
      JSON.stringify({
        status: 'stopped-safely',
        code: error.code || 'PILOT_FAILED',
        at: new Date().toISOString(),
      })
    );
    process.exitCode = 1;
  });
