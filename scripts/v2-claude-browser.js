#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { validateAuthorizeUrl } = require('../src/v2-claude-login');
try {
  const target = process.env.EKYBOT_AUTH_URL_FILE;
  if (!target || !path.isAbsolute(target) || path.basename(target) !== 'authorize-url') {
    throw new Error('Invalid destination');
  }
  const url = validateAuthorizeUrl(process.argv.at(-1));
  const temporary = `${target}.pending`;
  fs.writeFileSync(temporary, url, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, target);
} catch {
  process.exitCode = 1;
}
