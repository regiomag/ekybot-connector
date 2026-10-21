const { installNativeService } = require('../src/v2-install-service');
try {
  const [release, stateDir, machineFile] = process.argv.slice(2);
  console.log(
    JSON.stringify(
      installNativeService({
        label: 'com.ekybot.native-v2-chat',
        script: 'v2-native-worker.js',
        stateVariable: 'EKYBOT_NATIVE_STATE_DIR',
        release,
        stateDir,
        machineFile,
      })
    )
  );
} catch (error) {
  console.error(JSON.stringify({ installed: false, code: error.code || 'INSTALL_FAILED' }));
  process.exitCode = 1;
}
