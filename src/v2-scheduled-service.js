const path = require('node:path');
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
function buildScheduledPlist({ label, release, node, cwd, script, log, errorLog, env = {} }) {
  if (
    ![release, node, cwd, log, errorLog].every(path.isAbsolute) ||
    /^\/(?:private\/)?tmp\//.test(release) ||
    !/^[a-z0-9.-]+$/.test(label) ||
    !/^[a-z0-9-]+\.js$/.test(script) ||
    Object.keys(env).some((key) => !/^[A-Z_]+$/.test(key))
  ) {
    throw new Error('A persistent absolute release is required');
  }
  const environment = { PATH: '/usr/bin:/bin:/opt/homebrew/bin', LANG: 'en_US.UTF-8', ...env };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(path.join(release, 'scripts', script))}</string></array>
<key>WorkingDirectory</key><string>${xml(cwd)}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(environment)
    .map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`)
    .join('')}</dict>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>15</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(errorLog)}</string>
</dict></plist>\n`;
}
module.exports = { buildScheduledPlist };
