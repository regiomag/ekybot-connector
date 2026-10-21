const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { parseArgs } = require('../scripts/hermes-resume-preflight');

describe('metadata-only preflight command', () => {
  it('parses the two mutually exclusive inspection modes', () => {
    assert.equal(
      parseArgs(['--inspect-session', 'native', '--profile', 'test'])['--profile'],
      'test'
    );
    assert.equal(
      parseArgs(['--bindings', '/private/bindings.json', '--conversation', 'relay:key'])[
        '--conversation'
      ],
      'relay:key'
    );
  });
  it('rejects ambiguous, duplicate, missing and unknown arguments', () => {
    for (const args of [
      [],
      ['--bindings', '/file'],
      ['--profile'],
      ['--start', 'true'],
      ['--inspect-session', 'a', '--inspect-session', 'b'],
      ['--inspect-session', 'a', '--conversation', 'key'],
    ]) {
      assert.throws(() => parseArgs(args), { code: 'HERMES_PREFLIGHT_ARGUMENTS' });
    }
  });
  it('supports help and rejects aliases without starting Hermes or opening a database', () => {
    const script = require.resolve('../scripts/hermes-resume-preflight');
    const help = spawnSync(process.execPath, [script, '--help'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /read-only, no model calls/);
    const invalid = spawnSync(process.execPath, [script, '--inspect-session', 'latest'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stderr).modelInvoked, false);
    assert.equal(JSON.parse(invalid.stderr).code, 'HERMES_INVALID_SESSION');
  });
});
