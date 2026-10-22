const { installNativeService } = require('../src/v2-install-service');
try {
  const [release, stateDir, machineFile] = process.argv.slice(2);
  console.log(
    JSON.stringify(
      installNativeService({
        label: 'com.ekybot.development-v2',
        script: 'development-worker.js',
        stateVariable: 'EKYBOT_DEVELOPMENT_STATE_DIR',
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
