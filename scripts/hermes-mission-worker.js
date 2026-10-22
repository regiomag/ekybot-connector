require('../src/hermes-mission-worker')
  .runMissionTick({
    stateDir: process.env.EKYBOT_MISSION_STATE_DIR,
    machineFile: process.env.EKYBOT_NATIVE_MACHINE_FILE,
  })
  .then((result) => console.log(JSON.stringify({ ...result, at: new Date().toISOString() })))
  .catch(() => {
    console.error(JSON.stringify({ status: 'stopped-safely', code: 'MISSION_FAILED' }));
    process.exitCode = 1;
  });
