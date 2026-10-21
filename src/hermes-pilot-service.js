const path = require('node:path');
const LABEL = 'com.ekybot.hermes-v2-pilot';
const { buildScheduledPlist } = require('./v2-scheduled-service');
function buildPilotPlist({ release, node, home }) {
  if (![release, node, home].every(path.isAbsolute) || /^\/(?:private\/)?tmp\//.test(release)) {
    throw new Error('A persistent absolute release is required');
  }
  return buildScheduledPlist({
    label: LABEL,
    release,
    node,
    cwd: path.join(home, 'workspace'),
    script: 'hermes-pilot-worker.js',
    log: path.join(home, 'logs/pilot-worker.log'),
    errorLog: path.join(home, 'logs/pilot-worker-error.log'),
  });
}
module.exports = { LABEL, buildPilotPlist };
