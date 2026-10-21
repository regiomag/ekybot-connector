const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  assertSessionId,
  resolveHermesHome,
  inspectHermesSession,
  assertPersistedContinuation,
} = require('../src/hermes-session-safety');

const directories = [];
afterEach(() => {
  for (const dir of directories.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function database() {
  const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-db-test-'));
  directories.push(homeRoot);
  const file = path.join(homeRoot, 'state.db');
  const sql = (statement) => execFileSync('sqlite3', [file, statement], { encoding: 'utf8' });
  sql(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, profile_name TEXT, archived INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, handoff_state TEXT, end_reason TEXT, parent_session_id TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, active INTEGER DEFAULT 1, content TEXT);
    INSERT INTO sessions (id,source,profile_name,end_reason) VALUES ('20261021_120000_abcdef','cli','default','cli_close');
    INSERT INTO messages (id,session_id,content) VALUES (1,'20261021_120000_abcdef','Synthetic history');`);
  const params = { profile: 'default', sessionId: '20261021_120000_abcdef', homeRoot };
  return { homeRoot, file, sql, params };
}

describe('read-only native session validation', () => {
  it('reads only metadata and does not modify the database', async () => {
    const f = database();
    const before = fs.readFileSync(f.file);
    const snapshot = await inspectHermesSession(f.params);
    assert.equal(snapshot.activeMessages, 1);
    assert.equal(snapshot.lastMessageId, 1);
    assert.equal(snapshot.profile, 'default');
    assert.ok(!JSON.stringify(snapshot).includes('Synthetic history'));
    assert.deepEqual(fs.readFileSync(f.file), before);
  });
  it('fails closed on a missing exact ID, without resolving titles or prefixes', async () => {
    const f = database();
    await assert.rejects(inspectHermesSession({ ...f.params, sessionId: '20261021' }), {
      code: 'HERMES_SESSION_MISSING',
    });
  });
  it('rejects aliases, relay IDs, traversal and injection before SQLite', () => {
    for (const id of [
      'latest',
      'LATEST',
      '../state',
      'agent:a:ekybot:general',
      "abc';DROP TABLE sessions;",
      '',
      '--help',
      'a'.repeat(129),
    ]) {
      assert.throws(() => assertSessionId(id), { code: 'HERMES_INVALID_SESSION' });
    }
    assert.throws(() => resolveHermesHome('../profile'), /Invalid Hermes profile/);
  });
  it('rejects another profile, an external platform, and incomplete history', async () => {
    const f = database();
    f.sql("UPDATE sessions SET profile_name='research';");
    await assert.rejects(inspectHermesSession(f.params), { code: 'HERMES_SESSION_SCOPE' });
    f.sql("UPDATE sessions SET profile_name='default', source='telegram';");
    await assert.rejects(inspectHermesSession(f.params), { code: 'HERMES_SESSION_SCOPE' });
    f.sql("UPDATE sessions SET source='cli'; UPDATE messages SET active=0;");
    await assert.rejects(inspectHermesSession(f.params), { code: 'HERMES_EMPTY_SESSION' });
  });
  it('rejects active, handed-off, archived, hidden and branched sessions', async () => {
    const f = database();
    for (const expression of [
      'end_reason=NULL',
      "handoff_state='active'",
      'archived=1',
      'hidden=1',
    ]) {
      f.sql(
        `UPDATE sessions SET end_reason='cli_close',handoff_state=NULL,archived=0,hidden=0; UPDATE sessions SET ${expression};`
      );
      await assert.rejects(inspectHermesSession(f.params), {
        code: 'HERMES_SESSION_RECONCILIATION',
      });
    }
    f.sql(
      "UPDATE sessions SET hidden=0; INSERT INTO sessions (id,parent_session_id) VALUES ('compressed_child','20261021_120000_abcdef');"
    );
    await assert.rejects(inspectHermesSession(f.params), { code: 'HERMES_SESSION_RECONCILIATION' });
  });
  it('fails closed on an unknown schema, missing store, or symlinked database', async () => {
    const f = database();
    await assert.rejects(inspectHermesSession({ ...f.params, profile: 'missing' }), {
      code: 'HERMES_STORE_UNAVAILABLE',
    });
    f.sql('ALTER TABLE messages RENAME COLUMN active TO unsupported;');
    await assert.rejects(inspectHermesSession(f.params), { code: 'HERMES_STORE_UNVERIFIED' });
    fs.renameSync(f.file, `${f.file}.saved`);
    fs.symlinkSync(`${f.file}.saved`, f.file);
    await assert.rejects(inspectHermesSession(f.params), { code: 'HERMES_STORE_UNAVAILABLE' });
  });
  it('verifies persisted continuation, not just the presence of output', async () => {
    const f = database();
    const before = await inspectHermesSession(f.params);
    assert.throws(() => assertPersistedContinuation(before, before), {
      code: 'HERMES_CONTINUITY_UNVERIFIED',
    });
    f.sql(
      "INSERT INTO messages (id,session_id,content) VALUES (2,'20261021_120000_abcdef','New synthetic message');"
    );
    assert.doesNotThrow(() =>
      assertPersistedContinuation(before, { ...before, activeMessages: 2, lastMessageId: 2 })
    );
    assertPersistedContinuation(before, await inspectHermesSession(f.params));
  });
});
