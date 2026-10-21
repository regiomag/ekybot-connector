// One bounded tick, scheduled by launchd. No queue polling loop or automatic retry.
require('../src/v2-native-machine')
  .runNativeTick({
    stateDir: process.env.EKYBOT_NATIVE_STATE_DIR,
    machineFile: process.env.EKYBOT_NATIVE_MACHINE_FILE,
  })
  .then((result) => console.log(JSON.stringify({ ...result, at: new Date().toISOString() })))
  .catch((error) => {
    console.error(
      JSON.stringify({
        status: 'stopped-safely',
        code: error.code || 'NATIVE_FAILED',
        at: new Date().toISOString(),
      })
    );
    process.exitCode = 1;
  });
