const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFreshProfile, inspectFreshProfile } = require('../src/hermes-fresh-profile');

const fixtures = [];
afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// These stubs test the diagnostic's tripwires, not native Hermes semantics.
// The native reader qualification is a separate, explicit offline command.
function runProbe(
  action = '',
  extraEnv = {},
  { bootstrap = false, projectEnv = false, badPrefix = false } = {}
) {
  const prefix = bootstrap && !badPrefix ? 'ekybot-hermes-bootstrap.' : 'hermes-probe-test-';
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, prefix));
  fixtures.push(directory);
  const options = { root: path.join(directory, 'hermes'), profile: 'ekybot-v2-pilot' };
  const before = createFreshProfile(options);
  const runtime = path.join(directory, 'runtime');
  const modules = {
    'hermes_constants.py': `from pathlib import Path
import os
home = Path(os.environ['HERMES_HOME'])
def get_hermes_home(): return home
def get_default_hermes_root(): return home.parent.parent
`,
    'tools/__init__.py': '',
    'tools/memory_tool.py': `from hermes_constants import home
${action}
def get_memory_dir(): return home / 'memories'
class MemoryStore:
    def load_from_disk(self):
        get_memory_dir().mkdir(exist_ok=True)
        self.memory_entries = []
        self.user_entries = []
    def format_for_system_prompt(self, target): return None
`,
    'agent/__init__.py': '',
    'agent/prompt_builder.py': `from hermes_constants import home
def build_context_files_prompt(**kwargs):
    assert kwargs['skip_soul'] is True
    return ''
def load_soul_md(**kwargs):
    ${bootstrap ? "return (home / 'SOUL.md').read_text().strip()" : "raise RuntimeError('Bootstrap-dependent SOUL reader must not run')"}
`,
    'agent/skill_utils.py': `from hermes_constants import home
def get_all_skills_dirs(): return [home / 'skills']
def get_project_skills_dirs(): return []
`,
    'workspace-main/context.md': 'SYNTHETIC_OLD_CONTEXT',
    'hermes_cli/__init__.py': '',
    'hermes_cli/config.py': `from hermes_constants import home
import json
def ensure_hermes_home():
    for name in ('', 'cron', 'sessions', 'logs', 'logs/curator', 'memories', 'pairing', 'hooks', 'image_cache', 'audio_cache', 'skills'):
        target = home / name
        target.mkdir(parents=True, exist_ok=True)
        target.chmod(0o700)
def load_config(): return json.loads((home / 'config.yaml').read_text())
`,
    'hermes_cli/env_loader.py': `def load_hermes_dotenv(*, hermes_home, project_env):
    assert not project_env.exists()
    assert (hermes_home / '.env').read_text() == ''
    return [hermes_home / '.env']
`,
  };
  if (!bootstrap || projectEnv) {
    modules['.env'] = 'SYNTHETIC_SECRET_DO_NOT_PRINT';
  }
  for (const [relative, contents] of Object.entries(modules)) {
    const file = path.join(runtime, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  fs.symlinkSync(path.join(runtime, '.env'), path.join(runtime, 'alias.txt'));
  const result = spawnSync(
    process.env.EKYBOT_PROBE_PYTHON || 'python3',
    [
      '-I',
      '-B',
      path.resolve(__dirname, '../scripts/hermes-profile-isolation-probe.py'),
      '--runtime',
      runtime,
      '--home',
      before.home,
      '--root',
      before.root,
      ...(bootstrap ? ['--bootstrap-fixture', directory] : []),
    ],
    {
      // Keep Node/Python on the same canonical temp root without inheriting
      // the parent environment (especially provider credentials).
      env: { PATH: '/usr/bin:/bin', TMPDIR: temporaryRoot, HERMES_HOME: before.home, ...extraEnv },
      encoding: 'utf8',
      timeout: 10000,
    }
  );
  assert.ifError(result.error);
  if (!bootstrap) {
    assert.deepEqual(inspectFreshProfile(options), before, 'probe changed the prepared profile');
  } else {
    for (const [name, expected] of Object.entries(before.fileHashes)) {
      const digest = require('crypto')
        .createHash('sha256')
        .update(fs.readFileSync(path.join(before.home, name)))
        .digest('hex');
      assert.equal(digest, expected, `probe changed ${name}`);
    }
    assert.equal(fs.existsSync(path.join(before.home, 'state.db')), false);
    assert.equal(fs.existsSync(path.join(before.home, 'new-dir')), false);
  }
  assert.ok(!`${result.stdout}${result.stderr}`.includes('SYNTHETIC_SECRET_DO_NOT_PRINT'));
  return result;
}

describe('offline Hermes reader diagnostic tripwires', () => {
  it('accepts existing memory-directory mkdir only and reports its limited scope', () => {
    const result = runProbe();
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'passed');
    assert.equal(report.modelInvoked, false);
    assert.equal(report.soulLoaderTested, false);
    assert.equal(report.nativeBootstrapTested, false);
    assert.equal(report.fullRuntimeActivationQualified, false);
  });

  const blocked = [
    ['network', 'import socket; socket.socket()', 'socket.__new__'],
    ['subprocess', "import subprocess; subprocess.run(['/usr/bin/true'])", 'subprocess.Popen'],
    ['file write', "(home / 'state.db').write_text('bad')", 'file_write'],
    ['new directory', "(home / 'new-dir').mkdir()", 'os.mkdir'],
    ['native home bootstrap', 'home.mkdir(exist_ok=True)', 'os.mkdir'],
    ['permission change', 'home.chmod(0o700)', 'os.chmod'],
    ['dotenv read', "(Path(__file__).parents[1] / '.env').read_text()", 'legacy_or_secret_read'],
    [
      'secret via symlink',
      "(Path(__file__).parents[1] / 'alias.txt').read_text()",
      'legacy_or_secret_read',
    ],
    [
      'legacy context',
      "(Path(__file__).parents[1] / 'workspace-main/context.md').read_text()",
      'legacy_or_secret_read',
    ],
    [
      'swallowed optional failure',
      "try:\n    (home / 'state.db').write_text('bad')\nexcept Exception:\n    pass",
      'file_write',
    ],
  ];
  for (const [name, action, event] of blocked) {
    it(`rejects ${name} before the effect`, () => {
      const result = runProbe(`from pathlib import Path\n${action}`);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(`Offline isolation probe blocked ${event}`), result.stderr);
      assert.ok(!result.stdout.includes('"status": "passed"'));
    });
  }
  it('rejects credentials in the supplied environment before importing readers', () => {
    const result = runProbe('', { EXAMPLE_API_KEY: 'synthetic' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /credential-free environment/);
  });

  it('allows only expected native directories in an explicit disposable bootstrap fixture', () => {
    const result = runProbe('', {}, { bootstrap: true });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.scope, 'native-config-bootstrap');
    assert.equal(report.nativeBootstrapTested, true);
    assert.equal(report.soulLoaderTested, true);
    assert.equal(report.chatCliTested, false);
    assert.equal(report.providerAuthenticationTested, false);
    assert.equal(report.fullRuntimeActivationQualified, false);
    assert.equal(report.existingProfileFilesUnchanged, true);
    assert.deepEqual(report.dotenvFilesRead, ['.env']);
    assert.deepEqual(report.createdDirectories, [
      'audio_cache',
      'hooks',
      'image_cache',
      'logs/curator',
      'pairing',
    ]);
  });

  it('refuses a bootstrap runtime with a project dotenv without reading its contents', () => {
    const result = runProbe('', {}, { bootstrap: true, projectEnv: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Use a clean source export/);
  });

  it('refuses bootstrap writes outside the named disposable fixture', () => {
    const result = runProbe('', {}, { bootstrap: true, badPrefix: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AssertionError/);
  });

  for (const [name, action, event] of [
    ['file writes', "(home / 'state.db').write_text('bad')", 'file_write'],
    ['unexpected directories', "(home / 'new-dir').mkdir()", 'os.mkdir'],
    ['broader permissions', 'home.chmod(0o755)', 'os.chmod'],
    ['network', 'import socket; socket.socket()', 'socket.__new__'],
    ['subprocesses', "import subprocess; subprocess.run(['/usr/bin/true'])", 'subprocess.Popen'],
  ]) {
    it(`still rejects ${name} in bootstrap mode`, () => {
      const result = runProbe(action, {}, { bootstrap: true });
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(`Offline isolation probe blocked ${event}`), result.stderr);
    });
  }
});
