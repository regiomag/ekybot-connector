const path = require('node:path');
const { installNativeService } = require('../src/v2-install-service');
console.log(
  JSON.stringify(
    installNativeService({
      label: 'com.ekybot.missions-v2',
      script: 'hermes-mission-worker.js',
      stateVariable: 'EKYBOT_MISSION_STATE_DIR',
      release: path.resolve(__dirname, '..'),
      stateDir: process.env.EKYBOT_MISSION_STATE_DIR,
      machineFile: process.env.EKYBOT_NATIVE_MACHINE_FILE,
    })
  )
);
