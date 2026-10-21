const path = require('node:path');
const os = require('node:os');
const { runBmtTick } = require('../src/bmt-worker');
const root = path.join(os.homedir(), '.local/share/ekybot-v2');
runBmtTick({
  stateDir: process.env.EKYBOT_BMT_STATE_DIR || path.join(root, 'bmt'),
  machineFile:
    process.env.EKYBOT_NATIVE_MACHINE_FILE ||
    path.join(root, 'hermes/profiles/ekybot-v2-pilot/machine.json'),
})
  .then((result) => process.stdout.write(JSON.stringify(result) + '\n'))
  .catch(() => {
    process.stderr.write('BMT worker failed safely; inspect scoped state.\n');
    process.exitCode = 1;
  });
