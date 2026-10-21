const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPilotPlist, LABEL } = require('../src/hermes-pilot-service');
test('dedicated pilot service uses persistent code, bounded ticks and no secret environment', () => {
  const args = {
    release: '/Users/fixture/ekybot-v2/release',
    node: '/usr/local/bin/node',
    home: '/Users/fixture/ekybot-v2/profile',
  };
  const plist = buildPilotPlist(args);
  assert.ok(plist.includes(LABEL));
  assert.ok(plist.includes('<key>StartInterval</key><integer>15</integer>'));
  assert.ok(!plist.includes('KeepAlive'));
  assert.ok(!plist.includes('API_KEY'));
  assert.throws(() => buildPilotPlist({ ...args, release: '/private/tmp/release' }));
  assert.throws(() => buildPilotPlist({ ...args, node: '/bad\npath' }));
});
