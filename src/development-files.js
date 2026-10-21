const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');

const within = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);
const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');
const PROTECTED =
  /(^|\/)(\.git|\.ssh|\.aws|\.gnupg|\.codex|\.claude|\.agents|\.npmrc|\.netrc|\.env(?:\.[^/]*)?|auth\.json|machine\.json|enrollment-key\.json|credentials[^/]*|[^/]*\.(?:pem|key|p12|pfx))($|\/)/i;
const PRIVATE_MAC =
  /\/(?:Library\/(?:Keychains|Cookies|Mail|Messages|Application Support)|\.local\/share\/ekybot-v2)(?:\/|$)/;
const secret =
  /(?:sk-(?:ant-)?[A-Za-z0-9_-]{12,}|bmt_[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,})/g;
function redact(text) {
  return String(text)
    .replace(secret, '[SECRET REDACTED]')
    .replace(
      /^.*(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\s*[:=]\s*['"]?[^\s'"]{8,}.*$/gim,
      '[CREDENTIAL LINE REDACTED]'
    );
}
function permittedPath(
  { root, orchestrator = false, deniedRoots = [] },
  value,
  { write = false, create = false } = {}
) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) {
    throw new Error('Invalid path');
  }
  const target = path.resolve(root, value);
  if ((!orchestrator || write) && !within(root, target)) {
    throw new Error('Outside the selected project');
  }
  if (
    PROTECTED.test(target) ||
    PRIVATE_MAC.test(target) ||
    deniedRoots.some((p) => within(p, target))
  ) {
    throw new Error('Protected credentials or runtime configuration');
  }
  // Refuse every symlink component, not only the final path. No secret alias or
  // write-through link. Untrusted local users require a stronger OS boundary.
  let current = path.parse(target).root;
  for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      if (create && current === target && fs.statSync(path.dirname(target)).isDirectory()) {
        break;
      }
      throw new Error('Path does not exist');
    }
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('Symlink paths require a separate binding');
    }
  }
  return target;
}
function readText(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size > 512000) {
      throw new Error('File must be text and smaller than 512 KB');
    }
    const raw = fs.readFileSync(fd);
    if (raw.includes(0)) {
      throw new Error('Binary file is not supported');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } finally {
    fs.closeSync(fd);
  }
}
function readFile(policy, input) {
  const file = permittedPath(policy, input.path);
  const text = redact(readText(file));
  const rows = text.split('\n'),
    start = input.startLine || 1,
    count = input.lines || 150;
  return {
    path: file,
    totalLines: rows.length,
    startLine: start,
    text: rows
      .slice(start - 1, start - 1 + count)
      .map((v, i) => `${start + i}: ${v}`)
      .join('\n')
      .slice(0, 24000),
    source: 'untrusted_local_file',
  };
}
function listDirectory(policy, input) {
  const directory = permittedPath(policy, input.path);
  if (!fs.statSync(directory).isDirectory()) {
    throw new Error('Not a directory');
  }
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return {
    path: directory,
    truncated: entries.length > 200,
    entries: entries
      .filter((e) => !PROTECTED.test(`/${e.name}`))
      .slice(0, 200)
      .map((e) => ({
        name: e.name,
        type: e.isSymbolicLink() ? 'link-not-followed' : e.isDirectory() ? 'directory' : 'file',
      })),
  };
}
function editFile(policy, input, recoveryDir, id) {
  const file = permittedPath(policy, input.path, { write: true, create: true });
  if (file === policy.root) {
    throw new Error('A file is required');
  }
  const exists = fs.existsSync(file),
    before = exists ? readText(file) : null;
  if (redact(input.newText) !== input.newText || (before !== null && redact(before) !== before)) {
    throw new Error('Do not edit or persist secrets through development tools');
  }
  let after;
  if (before === null) {
    if (input.oldText !== '') {
      throw new Error('New files require empty oldText');
    }
    after = input.newText;
  } else {
    if (!input.oldText || before.split(input.oldText).length !== 2) {
      throw new Error('oldText must match exactly once');
    }
    after = before.replace(input.oldText, () => input.newText);
  }
  if (Buffer.byteLength(after) > 512000) {
    throw new Error('Edit exceeds file limit');
  }
  // Recovery contains no secrets (checked above), stays private and precedes the
  // effect. Never delete it as part of a retry or a failed native turn.
  fs.writeFileSync(
    path.join(recoveryDir, `${id}.before.json`),
    JSON.stringify({ path: file, before, afterHash: digest(after) }),
    { flag: 'wx', mode: 0o600 }
  );
  if (exists && readText(file) !== before) {
    throw new Error('File changed concurrently');
  }
  const fd = fs.openSync(
    file,
    (exists
      ? fs.constants.O_WRONLY
      : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL) |
      fs.constants.O_NOFOLLOW,
    0o600
  );
  try {
    fs.writeFileSync(fd, after);
    fs.ftruncateSync(fd, Buffer.byteLength(after));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { path: file, created: !exists, sha256: digest(after), recovery: id };
}
module.exports = {
  within,
  digest,
  redact,
  permittedPath,
  readFile,
  listDirectory,
  editFile,
  PROTECTED,
};
