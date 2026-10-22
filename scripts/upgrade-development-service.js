// Explicit upgrade of the development service only. Existing session journals,
// auth files, encrypted BMT keypair and all other services remain untouched.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const revision = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], {
  cwd: repo,
  encoding: 'utf8',
}).trim();
if (!/^[a-f0-9]{40}$/.test(revision) || process.argv[2] !== revision) {
  throw new Error('Pass the exact qualified commit');
}
if (
  execFileSync('/usr/bin/git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()
) {
  throw new Error('Commit all release files first');
}
const base = path.join(os.homedir(), '.local/share/ekybot-v2');
const state = path.join(base, 'development');
const plist = path.join(os.homedir(), 'Library/LaunchAgents/com.ekybot.development-v2.plist');
const old = fs.readFileSync(plist, 'utf8');
const parsed = JSON.parse(
  execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' })
);
const previous = path.dirname(path.dirname(parsed.ProgramArguments[1]));
const release = path.join(base, `development-companion-${revision.slice(0, 7)}`);
if (
  !previous.startsWith(base + '/development-companion-') ||
  parsed.WorkingDirectory !== state ||
  fs.existsSync(release) ||
  fs.existsSync(path.join(state, 'worker.lock'))
) {
  throw new Error('Upgrade precondition failed');
}
if (
  !fs
    .readFileSync(path.join(previous, 'package-lock.json'))
    .equals(fs.readFileSync(path.join(repo, 'package-lock.json')))
) {
  throw new Error('Dependencies changed; build a qualified installation first');
}
fs.mkdirSync(release, { mode: 0o700 });
const archive = execFileSync('/usr/bin/git', ['archive', revision], {
  cwd: repo,
  maxBuffer: 30 * 1024 * 1024,
});
execFileSync('/usr/bin/tar', ['-xf', '-', '-C', release], { input: archive });
fs.cpSync(path.join(previous, 'node_modules'), path.join(release, 'node_modules'), {
  recursive: true,
  errorOnExist: true,
});
execFileSync(
  process.execPath,
  ['-e', "require('./src/development-pool');require('./src/development-bmt')"],
  { cwd: release, stdio: 'ignore' }
);
execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}`, plist]);
if (fs.existsSync(path.join(state, 'worker.lock'))) {
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
  throw new Error('Worker was running; service left unchanged');
}
fs.writeFileSync(`${plist}.before-${revision.slice(0, 7)}`, old, { flag: 'wx', mode: 0o600 });
try {
  fs.writeFileSync(plist, old.replaceAll(previous, release), { mode: 0o600 });
  execFileSync('/usr/bin/plutil', ['-lint', plist], { stdio: 'ignore' });
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
} catch (error) {
  fs.writeFileSync(plist, old, { mode: 0o600 });
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
  throw error;
}
console.log(
  JSON.stringify({ upgraded: true, release, previous, journalsPreserved: true, keysCopied: false })
);
