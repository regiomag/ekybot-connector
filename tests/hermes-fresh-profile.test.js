const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  planFreshProfile,
  createFreshProfile,
  inspectFreshProfile,
  PREPARED_MARKER,
} = require('../src/hermes-fresh-profile');
const { resolveHermesHome } = require('../src/hermes-session-safety');

const fixtures = [];
afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
function fixture() {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hermes-fresh-test-'));
  fixtures.push(directory);
  return { directory, root: path.join(directory, 'v2-hermes'), profile: 'ekybot-v2-pilot' };
}

describe('fresh offline Hermes profile', () => {
  it('plans without writing any directory or importing old configuration', () => {
    const f = fixture();
    const plan = planFreshProfile(f);
    assert.equal(fs.existsSync(f.root), false);
    assert.equal(plan.files['.env'], '');
    assert.equal(JSON.parse(plan.files['config.yaml']).model, '');
    assert.equal(resolveHermesHome(f.profile, f.root), plan.home);
  });
  it('creates private empty memory, sessions, skills and a permanent execution block', () => {
    const f = fixture();
    const result = createFreshProfile(f);
    assert.equal(result.status, 'prepared-offline');
    assert.equal(result.executionAllowed, false);
    assert.equal(result.memoryBytes, 0);
    assert.equal(result.userMemoryBytes, 0);
    assert.equal(result.sessions, 0);
    assert.equal(result.skills, 0);
    assert.deepEqual(inspectFreshProfile(f), result);
    assert.equal(fs.statSync(result.home).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(result.home, '.env')).mode & 0o777, 0o600);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(result.home, PREPARED_MARKER))).executionAllowed,
      false
    );
  });
  it('never overwrites an existing profile, including incomplete provisioning', () => {
    const f = fixture();
    const result = createFreshProfile(f);
    const file = path.join(result.home, 'memories', 'MEMORY.md');
    fs.writeFileSync(file, 'Synthetic existing memory');
    assert.throws(() => createFreshProfile(f), { code: 'HERMES_PROFILE_EXISTS' });
    assert.equal(fs.readFileSync(file, 'utf8'), 'Synthetic existing memory');
    fs.unlinkSync(path.join(result.home, 'config.yaml'));
    assert.throws(() => createFreshProfile(f), { code: 'HERMES_PROFILE_EXISTS' });
  });
  it('refuses the legacy root, aliases, traversal and noncanonical paths', () => {
    const f = fixture();
    for (const profile of ['default', '../old', 'Profile', 'agent:key', '']) {
      assert.throws(() => planFreshProfile({ ...f, profile }), {
        code: 'HERMES_PROFILE_INVALID_TARGET',
      });
    }
    for (const root of ['relative', `${f.root}/../other`]) {
      assert.throws(() => planFreshProfile({ ...f, root }), {
        code: 'HERMES_PROFILE_INVALID_TARGET',
      });
    }
    assert.throws(() => planFreshProfile({ ...f, root: path.join(os.homedir(), '.hermes') }), {
      code: 'HERMES_PROFILE_LEGACY_ROOT',
    });
  });
  it('refuses a root carrying shared configuration or credentials', () => {
    const f = fixture();
    fs.mkdirSync(f.root, { mode: 0o700 });
    fs.writeFileSync(path.join(f.root, '.env'), 'SYNTHETIC=sentinel');
    assert.throws(() => createFreshProfile(f), { code: 'HERMES_PROFILE_ROOT_NOT_EMPTY' });
    assert.equal(fs.existsSync(path.join(f.root, 'profiles')), false);
  });
  it('refuses symlinks in ancestor paths before any provisioning', () => {
    const f = fixture();
    const link = path.join(f.directory, 'linked');
    fs.symlinkSync(f.directory, link);
    assert.throws(() => createFreshProfile({ ...f, root: path.join(link, 'new-root') }), {
      code: 'HERMES_PROFILE_UNSAFE_PATH',
    });
    assert.equal(fs.existsSync(path.join(f.directory, 'new-root')), false);
  });
  it('rejects inherited files, changed memory, and non-private state on inspection', () => {
    const f = fixture();
    const result = createFreshProfile(f);
    const extra = path.join(result.home, 'auth.json');
    fs.writeFileSync(extra, '{}');
    assert.throws(() => inspectFreshProfile(f), { code: 'HERMES_PROFILE_NOT_FRESH' });
    fs.unlinkSync(extra);
    const memory = path.join(result.home, 'memories', 'MEMORY.md');
    fs.writeFileSync(memory, 'SYNTHETIC');
    assert.throws(() => inspectFreshProfile(f), { code: 'HERMES_PROFILE_NOT_FRESH' });
    fs.writeFileSync(memory, '');
    fs.chmodSync(memory, 0o644);
    assert.throws(() => inspectFreshProfile(f), { code: 'HERMES_PROFILE_UNSAFE_PATH' });
  });
  it('rejects added skills, project context and runtime history', () => {
    const f = fixture();
    const result = createFreshProfile(f);
    for (const name of ['skills/old-skill', 'workspace/AGENTS.md', 'sessions/old.json']) {
      const file = path.join(result.home, name);
      fs.writeFileSync(file, 'SYNTHETIC');
      assert.throws(() => inspectFreshProfile(f), { code: 'HERMES_PROFILE_NOT_FRESH' });
      fs.unlinkSync(file);
    }
  });
});
