const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSandboxed } = require('../src/development-command');
test(
  'Mac command sandbox confines reads, writes, environment and network',
  {
    skip: process.env.EKYBOT_QUALIFY_SANDBOX !== '1',
    timeout: 60000,
  },
  async () => {
    const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ekybot-command-test-')));
    const root = path.join(parent, 'project');
    fs.mkdirSync(root, { mode: 0o700 });
    fs.writeFileSync(path.join(parent, 'outside'), 'outside-value');
    fs.writeFileSync(path.join(root, '.env'), 'secret-value');
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, '.git/config'), 'protected-git');
    process.env.EKYBOT_TEST_CREDENTIAL = 'never-inherited';
    const result = await runSandboxed({
      root,
      command: '/bin/sh',
      args: [
        '-c',
        `printf safe > written; cat ../outside; cat .env; cat .git/config; printf bad > ../escape; printf bad > .git/config; env; curl --max-time 3 https://example.com; /usr/bin/xcodebuild -version`,
      ],
      timeoutMs: 15000,
    });
    assert.equal(fs.readFileSync(path.join(root, 'written'), 'utf8'), 'safe');
    assert.equal(fs.readFileSync(path.join(root, '.git/config'), 'utf8'), 'protected-git');
    assert.equal(fs.existsSync(path.join(parent, 'escape')), false);
    assert.doesNotMatch(
      result.stdout,
      /outside-value|secret-value|protected-git|never-inherited|Example Domain/
    );
    assert.match(result.stdout, /Xcode /);
    assert.equal(result.interrupted, false);
  }
);
