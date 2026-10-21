const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test(
  'isolated public Web transport, budgets, login boundaries and NAT64 SSRF guards',
  {
    skip:
      !process.env.EKYBOT_PROBE_PYTHON ||
      !process.env.EKYBOT_NATIVE_RUNTIME ||
      !process.env.EKYBOT_NATIVE_PACKAGES,
  },
  () => {
    const result = spawnSync(
      process.env.EKYBOT_PROBE_PYTHON,
      ['-I', '-B', '-S', path.resolve('tests/hermes_web_tools_test.py')],
      {
        env: {
          PATH: '/usr/bin:/bin',
          EKYBOT_NATIVE_RUNTIME: process.env.EKYBOT_NATIVE_RUNTIME,
          EKYBOT_NATIVE_PACKAGES: process.env.EKYBOT_NATIVE_PACKAGES,
        },
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 100000,
      }
    );
    assert.equal(result.status, 0, result.stderr);
  }
);
