const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const policy = fs.readFileSync(path.join(__dirname, 'bmt-system-prompt.txt'), 'utf8');
if (policy.length > 40000 || /bmt_[A-Za-z0-9_-]{16,}/.test(policy)) {
  throw new Error('Invalid bundled BMT policy');
}
const policyVersion = '2026-10-22';
const policyHash = crypto.createHash('sha256').update(policy).digest('hex');
module.exports = { policy, policyVersion, policyHash };
