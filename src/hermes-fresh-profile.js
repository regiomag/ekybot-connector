// Provisioning only: no Hermes import/process, credentials, session or model.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { safetyError } = require('./hermes-session-safety');

const PREPARED_MARKER = '.ekybot-prepared-offline.json';
const DEFAULT_ROOT = path.join(os.homedir(), '.local', 'share', 'ekybot-v2', 'hermes');
const DEFAULT_PROFILE = 'ekybot-v2-pilot';
const DIRECTORIES = [
  'memories',
  'sessions',
  'skills',
  'plugins',
  'logs',
  'cron',
  'plans',
  'workspace',
  'home',
];
const SOUL =
  '# Ekybot V2\n\nTu es un nouvel assistant. Tu ne disposes d’aucun historique ni souvenir antérieur.\nN’invente pas de connaissances personnelles sur l’utilisateur. Demande les informations nécessaires.\nRespecte les autorisations explicites pour les outils, fichiers et projets. Ne conserve jamais de secret dans la mémoire.\n';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function assertNoSymlinkChain(target) {
  let current = target;
  for (;;) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw safetyError(
          'HERMES_PROFILE_UNSAFE_PATH',
          'Profile paths must not traverse symlinks.'
        );
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

function planFreshProfile({ root = DEFAULT_ROOT, profile = DEFAULT_PROFILE } = {}) {
  if (
    typeof root !== 'string' ||
    !path.isAbsolute(root) ||
    path.normalize(root) !== root ||
    typeof profile !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile) ||
    profile === 'default'
  ) {
    throw safetyError(
      'HERMES_PROFILE_INVALID_TARGET',
      'Use an absolute canonical root and a new lowercase named profile.'
    );
  }
  // A separate custom Hermes root avoids the native ~/.hermes root's
  // profile/auth/managed-config fallback. Never seed inside the old runtime.
  for (const forbidden of [
    path.join(os.homedir(), '.hermes'),
    path.join(os.homedir(), '.openclaw'),
  ]) {
    if (root === forbidden || root.startsWith(`${forbidden}${path.sep}`)) {
      throw safetyError(
        'HERMES_PROFILE_LEGACY_ROOT',
        'The V2 root must be separate from the legacy Hermes/OpenClaw directories.'
      );
    }
  }
  const home = path.join(root, 'profiles', profile);
  const workspace = path.join(home, 'workspace');
  assertNoSymlinkChain(home);
  const config = {
    model: '',
    providers: {},
    fallback_providers: [],
    toolsets: [],
    platform_toolsets: { cli: [] },
    terminal: { backend: 'local', cwd: workspace },
    memory: {
      memory_enabled: true,
      user_profile_enabled: true,
      write_approval: true,
      provider: '',
    },
    skills: {
      external_dirs: [],
      create_dir: '',
      project_discovery: false,
      trusted_project_dirs: [],
    },
    mcp_servers: {},
  };
  const files = {
    'config.yaml': `${JSON.stringify(config, null, 2)}\n`, // JSON is valid YAML; no parser dependency.
    '.env': '',
    'SOUL.md': SOUL,
    '.no-bundled-skills': 'Provisioned offline by Ekybot V2; no skill seeding requested.\n',
    'memories/MEMORY.md': '',
    'memories/USER.md': '',
  };
  return { root, profile, home, workspace, files };
}

function assertPrivate(target, directory) {
  const stat = fs.lstatSync(target);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    stat.mode & 0o077 ||
    (process.getuid && stat.uid !== process.getuid())
  ) {
    throw safetyError(
      'HERMES_PROFILE_UNSAFE_PATH',
      'The V2 profile must use private, owner-controlled regular files and directories.'
    );
  }
}

function writeNew(file, content) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function createFreshProfile(options) {
  const plan = planFreshProfile(options);
  // A first provisioning only. Existing content (even an empty profile) is
  // never overwritten, reset or automatically "repaired".
  if (fs.existsSync(plan.home)) {
    throw safetyError(
      'HERMES_PROFILE_EXISTS',
      'The target profile already exists; refusing to overwrite it.'
    );
  }
  if (fs.existsSync(plan.root)) {
    assertPrivate(plan.root, true);
    const entries = fs.readdirSync(plan.root);
    if (entries.some((name) => name !== 'profiles')) {
      throw safetyError(
        'HERMES_PROFILE_ROOT_NOT_EMPTY',
        'The V2 root contains inherited or unqualified configuration.'
      );
    }
  }
  fs.mkdirSync(plan.root, { recursive: true, mode: 0o700 });
  const profiles = path.join(plan.root, 'profiles');
  fs.mkdirSync(profiles, { recursive: true, mode: 0o700 });
  assertNoSymlinkChain(plan.home);
  assertPrivate(plan.root, true);
  assertPrivate(profiles, true);
  fs.mkdirSync(plan.home, { mode: 0o700 }); // exclusive leaf creation
  // This permanent quarantine marker is written first. Partial provisioning
  // is not runnable, and a future activation workflow must be explicit.
  writeNew(
    path.join(plan.home, PREPARED_MARKER),
    JSON.stringify({
      version: 1,
      status: 'prepared-offline',
      profile: plan.profile,
      root: plan.root,
      executionAllowed: false,
    })
  );
  for (const dir of DIRECTORIES) {
    fs.mkdirSync(path.join(plan.home, dir), { mode: 0o700 });
  }
  for (const [name, content] of Object.entries(plan.files)) {
    writeNew(path.join(plan.home, name), content);
  }
  const fd = fs.openSync(plan.home, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return inspectFreshProfile(options);
}

function inspectFreshProfile(options) {
  const plan = planFreshProfile(options);
  for (const dir of [
    plan.root,
    path.dirname(plan.home),
    plan.home,
    ...DIRECTORIES.map((name) => path.join(plan.home, name)),
  ]) {
    assertPrivate(dir, true);
  }
  if (fs.readdirSync(plan.root).some((name) => name !== 'profiles')) {
    throw safetyError('HERMES_PROFILE_ROOT_NOT_EMPTY', 'The V2 root has unqualified shared state.');
  }
  const expected = new Set([
    PREPARED_MARKER,
    ...DIRECTORIES,
    ...Object.keys(plan.files).filter((name) => !name.includes('/')),
  ]);
  if (fs.readdirSync(plan.home).some((name) => !expected.has(name))) {
    throw safetyError(
      'HERMES_PROFILE_NOT_FRESH',
      'Unexpected configuration, credentials or runtime state in the fresh profile.'
    );
  }
  const markerPath = path.join(plan.home, PREPARED_MARKER);
  assertPrivate(markerPath, false);
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (
    marker.version !== 1 ||
    marker.status !== 'prepared-offline' ||
    marker.executionAllowed !== false ||
    marker.profile !== plan.profile ||
    marker.root !== plan.root
  ) {
    throw safetyError('HERMES_PROFILE_NOT_FRESH', 'The offline preparation marker is invalid.');
  }
  const fileHashes = {};
  for (const [name, content] of Object.entries(plan.files)) {
    const file = path.join(plan.home, name);
    assertPrivate(file, false);
    const stat = fs.statSync(file);
    if (stat.size !== Buffer.byteLength(content) || hash(fs.readFileSync(file)) !== hash(content)) {
      throw safetyError(
        'HERMES_PROFILE_NOT_FRESH',
        'A prepared profile file differs from its empty, credential-free template.'
      );
    }
    fileHashes[name] = hash(content);
  }
  for (const dir of DIRECTORIES) {
    const allowed = dir === 'memories' ? ['MEMORY.md', 'USER.md'] : [];
    if (fs.readdirSync(path.join(plan.home, dir)).some((name) => !allowed.includes(name))) {
      throw safetyError(
        'HERMES_PROFILE_NOT_FRESH',
        'The profile already contains memory, skills, context or runtime state.'
      );
    }
  }
  return {
    status: 'prepared-offline',
    profile: plan.profile,
    root: plan.root,
    home: plan.home,
    workspace: plan.workspace,
    executionAllowed: false,
    memoryBytes: 0,
    userMemoryBytes: 0,
    sessions: 0,
    skills: 0,
    credentialsCopied: false,
    fileHashes,
  };
}

module.exports = {
  planFreshProfile,
  createFreshProfile,
  inspectFreshProfile,
  PREPARED_MARKER,
  DEFAULT_ROOT,
  DEFAULT_PROFILE,
};
