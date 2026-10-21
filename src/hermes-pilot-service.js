const path = require('node:path');
const LABEL = 'com.ekybot.hermes-v2-pilot';
const xml = (value) => {
  if (typeof value !== 'string' || [...value].some((character) => character.charCodeAt(0) < 32)) {
    throw new Error('Unsafe launchd value');
  }
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
};
function buildPilotPlist({ release, node, home }) {
  if (![release, node, home].every(path.isAbsolute) || /^\/(?:private\/)?tmp\//.test(release)) {
    throw new Error('A persistent absolute release is required');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(path.join(release, 'scripts/hermes-pilot-worker.js'))}</string></array>
<key>WorkingDirectory</key><string>${xml(path.join(home, 'workspace'))}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin:/opt/homebrew/bin</string><key>LANG</key><string>en_US.UTF-8</string></dict>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>15</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(path.join(home, 'logs/pilot-worker.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(home, 'logs/pilot-worker-error.log'))}</string>
</dict></plist>\n`;
}
module.exports = { LABEL, buildPilotPlist };
