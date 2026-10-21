const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { createFreshProfile } = require('../src/hermes-fresh-profile');
const fixtures = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Fake modules exercise policy only. Native import is a separate offline recipe.
function probe(
  action = '',
  { bootstrap = true, login = false, wrongFixture = false, extraEnv = {} } = {}
) {
  const root = fs.mkdtempSync('/private/tmp/ekybot-hermes-auth.');
  fixtures.push(root);
  const profile = createFreshProfile({ root: path.join(root, 'hermes') });
  const runtime = path.join(root, 'runtime');
  const packages = path.join(root, 'site-packages');
  fs.mkdirSync(packages);
  const modules = {
    'hermes_constants.py': `import os\nfrom pathlib import Path\nhome=Path(os.environ['HERMES_HOME'])\ndef get_hermes_home(): return home\ndef get_default_hermes_root(): return home.parent.parent\n`,
    'hermes_cli/__init__.py': '',
    'hermes_cli/auth.py': `from hermes_constants import home\nfrom pathlib import Path\nfor name in ('', 'cron', 'sessions', 'logs', 'logs/curator', 'memories', 'pairing', 'hooks', 'image_cache', 'audio_cache', 'skills'):\n    target=home/name\n    target.mkdir(exist_ok=True)\n    target.chmod(0o700)\n${action}\ndef _auth_file_path(): return home/'auth.json'\n`,
    '.codex/auth.json': 'SYNTHETIC_SECRET_MUST_NOT_APPEAR',
  };
  const hashes = {};
  for (const [name, content] of Object.entries(modules)) {
    const file = path.join(runtime, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    if (name === 'hermes_constants.py' || name === 'hermes_cli/auth.py')
      {hashes[name] = crypto.createHash('sha256').update(content).digest('hex');}
  }
  const script = path.resolve(__dirname, '../scripts/hermes-pilot-auth.py');
  const args = [
    '--runtime',
    runtime,
    '--profile-home',
    profile.home,
    '--site-packages',
    packages,
    ...(bootstrap ? ['--bootstrap-fixture', wrongFixture ? '/private/tmp' : root] : []),
    ...(login ? ['--login'] : []),
  ];
  // No production escape hatch: only the test harness substitutes the fixture hashes.
  const harness = `import importlib.util,sys\nspec=importlib.util.spec_from_file_location('probe',${JSON.stringify(script)})\nmodule=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(module)\nmodule.HASHES=${JSON.stringify(hashes)}\nsys.argv=['probe']+${JSON.stringify(args)}\nmodule.main()\n`;
  const result = spawnSync(
    process.env.EKYBOT_PROBE_PYTHON || 'python3',
    ['-I', '-B', '-S', '-c', harness],
    {
      env: { PATH: '/usr/bin:/bin', HERMES_HOME: profile.home, ...extraEnv },
      encoding: 'utf8',
      timeout: 10000,
    }
  );
  assert.ifError(result.error);
  for (const [name, hash] of Object.entries(profile.fileHashes)) {
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(profile.home, name)))
        .digest('hex'),
      hash
    );
  }
  for (const name of ['auth.json', 'state.db', 'new-dir'])
    {assert.equal(fs.existsSync(path.join(profile.home, name)), false);}
  assert.ok(!`${result.stdout}${result.stderr}`.includes('SYNTHETIC_SECRET_MUST_NOT_APPEAR'));
  return result;
}

test('offline auth bootstrap allows exactly the native directory skeleton', () => {
  const result = probe();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.createdDirectories, [
    'audio_cache',
    'hooks',
    'image_cache',
    'logs/curator',
    'pairing',
  ]);
  assert.equal(report.existingProfileFilesUnchanged, true);
  assert.equal(report.providerAuthenticationTested, false);
  assert.equal(report.loginEnabled, false);
  assert.equal(report.modelInvoked, false);
});
for (const [name, action, expected] of [
  ['network', 'import socket; socket.socket()', 'network_in_check'],
  ['subprocess', "import subprocess; subprocess.run(['/usr/bin/true'])", 'subprocess.Popen'],
  ['credential write', "(home/'auth.json').write_text('fake')", 'unexpected_write'],
  ['session write', "(home/'state.db').write_text('fake')", 'unexpected_write'],
  ['unlisted directory', "(home/'new-dir').mkdir()", 'os.mkdir'],
  ['broader permissions', 'home.chmod(0o755)', 'os.chmod'],
  ['parent directory', 'home.parent.mkdir(exist_ok=True)', 'os.mkdir'],
  [
    'legacy credential read',
    "(Path(__file__).parents[1]/'.codex/auth.json').read_text()",
    'legacy_or_secret_read',
  ],
  [
    'swallowed write failure',
    "try:\n    (home/'auth.json').write_text('fake')\nexcept Exception:\n    pass",
    'unexpected_write',
  ],
]) {
  test(`offline auth bootstrap rejects ${name}`, () => {
    const result = probe(action);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(expected), result.stderr);
  });
}
test('strict read-only mode still rejects native initialization', () => {
  const result = probe('', { bootstrap: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /os.mkdir/);
});
test('bootstrap refuses a non-fixture target', () => {
  const result = probe('', { wrongFixture: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AssertionError/);
});
test('inherited credentials are rejected before imports', () => {
  const result = probe('', { extraEnv: { OPENAI_API_KEY: 'fake-only' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Do not inherit/);
});
test('device login remains disabled even when explicitly requested', () => {
  const result = probe('', { login: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Enrollment inactive/);
});
