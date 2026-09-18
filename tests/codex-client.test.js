const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');

const { resolveSessionId } = require('../src/codex-client');

describe('Codex session bindings', () => {
  afterEach(() => {
    delete process.env.EKYBOT_CODEX_SESSION_MAP;
  });

  it('resolves a session by runtime id', () => {
    process.env.EKYBOT_CODEX_SESSION_MAP = JSON.stringify({
      'codex-review': '01a0b4ff-d711-7ff3-ae35-eb71bdda28d2',
    });

    assert.equal(
      resolveSessionId('codex-review'),
      '01a0b4ff-d711-7ff3-ae35-eb71bdda28d2',
    );
  });

  it('prefers an explicit session id', () => {
    process.env.EKYBOT_CODEX_SESSION_MAP = JSON.stringify({
      'codex-review': 'mapped-session',
    });

    assert.equal(resolveSessionId('codex-review', 'explicit-session'), 'explicit-session');
  });

  it('ignores malformed session maps', () => {
    process.env.EKYBOT_CODEX_SESSION_MAP = '{broken';

    assert.equal(resolveSessionId('codex-review'), null);
  });
});
