// No Hermes imports: opening its SessionDB can run migrations/maintenance.
// Inspect only metadata through SQLite's read-only mode; never read prompts.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { assertValidProfile } = require('./runtime-adapter');

const execFileAsync = promisify(execFile);
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function safetyError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

function normalizeProfile(profile) {
  assertValidProfile(profile);
  return profile || 'default';
}

function assertSessionId(sessionId) {
  if (
    typeof sessionId !== 'string' ||
    !SESSION_ID_PATTERN.test(sessionId) ||
    /^(latest|default)$/i.test(sessionId)
  ) {
    throw safetyError(
      'HERMES_INVALID_SESSION',
      'An exact Hermes session ID is required; aliases and relay keys are forbidden.'
    );
  }
}

function resolveHermesHome(
  profile,
  root = process.env.EKYBOT_HERMES_HOME_ROOT || path.join(os.homedir(), '.hermes')
) {
  const name = normalizeProfile(profile);
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.normalize(root) !== root) {
    throw safetyError(
      'HERMES_PROFILE_INVALID_TARGET',
      'The configured Hermes root must be an absolute canonical path.'
    );
  }
  return name === 'default' ? root : path.join(root, 'profiles', name);
}

async function inspectHermesSession({ profile, sessionId, homeRoot }) {
  assertSessionId(sessionId);
  const name = normalizeProfile(profile);
  const home = resolveHermesHome(name, homeRoot);
  const database = path.join(home, 'state.db');
  let canonicalHome;
  let identity;
  try {
    // No symlink may switch the selected profile or database underneath us.
    if (fs.lstatSync(home).isSymbolicLink() || fs.lstatSync(database).isSymbolicLink()) {
      throw new Error('symlink');
    }
    canonicalHome = fs.realpathSync(home);
    const stat = fs.statSync(database);
    if (!stat.isFile()) {
      throw new Error('not a database file');
    }
    identity = `${stat.dev}:${stat.ino}`;
  } catch {
    throw safetyError(
      'HERMES_STORE_UNAVAILABLE',
      'The selected Hermes profile has no safely readable session database.'
    );
  }

  // sessionId has been validated against a deliberately narrow alphabet.
  // No fallback query by title, prefix, most recent session or another profile.
  const sql = `SELECT s.id, s.source, s.profile_name, s.archived, s.hidden,
    s.handoff_state, s.end_reason,
    (SELECT COUNT(*) FROM sessions c WHERE c.parent_session_id=s.id) AS children,
    (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id AND m.active=1) AS active_messages,
    (SELECT COALESCE(MAX(m.id),0) FROM messages m WHERE m.session_id=s.id AND m.active=1) AS last_message_id
    FROM sessions s WHERE s.id='${sessionId}';`;
  let row;
  try {
    const result = await execFileAsync('sqlite3', ['-readonly', '-json', database, sql], {
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    const rows = JSON.parse(result.stdout || '[]');
    if (!Array.isArray(rows) || rows.length > 1) {
      throw new Error('unexpected metadata');
    }
    row = rows[0];
  } catch {
    throw safetyError(
      'HERMES_STORE_UNVERIFIED',
      'The Hermes session schema or read-only inspection could not be verified.'
    );
  }
  if (!row || row.id !== sessionId) {
    throw safetyError(
      'HERMES_SESSION_MISSING',
      'The exact session does not exist in the selected Hermes profile.'
    );
  }
  if (row.profile_name !== name || row.source !== 'cli') {
    throw safetyError(
      'HERMES_SESSION_SCOPE',
      'The session profile or source does not match the qualified CLI resume path.'
    );
  }
  if (
    row.archived ||
    row.hidden ||
    row.handoff_state ||
    row.children ||
    !['cli_close', 'agent_close'].includes(row.end_reason)
  ) {
    throw safetyError(
      'HERMES_SESSION_RECONCILIATION',
      'The session is active, handed off, archived or branched; reconcile it before resuming.'
    );
  }
  if (!Number.isInteger(row.active_messages) || row.active_messages < 1) {
    throw safetyError(
      'HERMES_EMPTY_SESSION',
      'The selected session has no persisted active history.'
    );
  }
  return {
    sessionId,
    profile: name,
    home: canonicalHome,
    databaseIdentity: identity,
    activeMessages: row.active_messages,
    lastMessageId: row.last_message_id,
  };
}

function assertPersistedContinuation(before, after) {
  if (
    after.sessionId !== before.sessionId ||
    after.profile !== before.profile ||
    after.home !== before.home ||
    after.databaseIdentity !== before.databaseIdentity ||
    after.lastMessageId <= before.lastMessageId ||
    after.activeMessages <= before.activeMessages
  ) {
    throw safetyError(
      'HERMES_CONTINUITY_UNVERIFIED',
      'The reply was not verified as persisted in the exact resumed session. Manual reconciliation is required.'
    );
  }
}

module.exports = {
  safetyError,
  normalizeProfile,
  assertSessionId,
  resolveHermesHome,
  inspectHermesSession,
  assertPersistedContinuation,
};
