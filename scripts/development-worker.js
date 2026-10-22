require('../src/development-worker')
  .runDevelopmentTick({
    stateDir: process.env.EKYBOT_DEVELOPMENT_STATE_DIR,
    machineFile: process.env.EKYBOT_NATIVE_MACHINE_FILE,
  })
  .then((result) => console.log(JSON.stringify({ ...result, at: new Date().toISOString() })))
  .catch((error) => {
    console.error(
      JSON.stringify({ status: 'stopped-safely', code: error.code || 'DEVELOPMENT_FAILED' })
    );
    process.exitCode = 1;
  });
