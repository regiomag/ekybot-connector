require('../src/v2-auth-machine')
  .runAuthTick({
    stateDir: process.env.EKYBOT_AUTH_STATE_DIR,
    machineFile: process.env.EKYBOT_NATIVE_MACHINE_FILE,
  })
  .then((result) => console.log(JSON.stringify({ ...result, at: new Date().toISOString() })))
  .catch(() => {
    console.error('Native authentication stopped safely.');
    process.exitCode = 1;
  });
