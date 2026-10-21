const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readPrivateJson, writeDurableJson, HermesResumeGuard } = require('./hermes-resume-guard');
const { digest } = require('./development-files');
const { validSessionId } = require('./v2-codex-runtime');
const GIT = '/usr/bin/git';
const gitArgs = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'diff.external=',
  '-c',
  'core.pager=cat',
];
function git(root, args, options = {}) {
  return execFileSync(GIT, [...gitArgs, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 512000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}
function projectCatalog(file) {
  const config = readPrivateJson(file);
  if (config.version !== 1 || !Array.isArray(config.projects) || config.projects.length > 60) {
    throw new Error('Invalid project registry');
  }
  const ids = new Set();
  return config.projects.map((p) => {
    if (
      !/^[a-z0-9-]{1,60}$/.test(p.id || '') ||
      ids.has(p.id) ||
      !p.name ||
      p.name.length > 80 ||
      !path.isAbsolute(p.path || '') ||
      p.path === '/' ||
      fs.realpathSync(p.path) !== p.path
    ) {
      throw new Error('Invalid project binding');
    }
    ids.add(p.id);
    const root = git(p.path, ['rev-parse', '--show-toplevel']).trim();
    if (root !== p.path) {
      throw new Error('Project must name a Git root');
    }
    const commit = git(root, ['rev-parse', '--verify', `${p.ref || 'HEAD'}^{commit}`]).trim();
    return {
      id: p.id,
      name: p.name,
      path: root,
      ref: p.ref || 'HEAD',
      commit,
      fingerprint: digest([root, p.ref || 'HEAD'].join('\0')),
    };
  });
}
function prepareWorkspace({ stateDir, channelId, project, engine }) {
  if (!validSessionId(channelId) || !['codex', 'claude', 'hermes'].includes(engine)) {
    throw new Error('Invalid development identity');
  }
  const root = path.join(stateDir, 'workspaces');
  new HermesResumeGuard({ stateDir: root }).ensureDirectory();
  const key = `${channelId}-${project.id}-${engine}`;
  const target = path.join(root, key),
    bindingFile = `${target}.json`;
  const branch = `Mini/ekybot-${channelId.slice(0, 8)}-${project.id}-${engine}`;
  if (fs.existsSync(bindingFile)) {
    const binding = readPrivateJson(bindingFile);
    if (
      binding.projectFingerprint !== project.fingerprint ||
      binding.branch !== branch ||
      binding.path !== target ||
      fs.realpathSync(target) !== target ||
      git(target, ['branch', '--show-current']).trim() !== branch
    ) {
      throw new Error('Workspace binding changed');
    }
    return binding;
  }
  if (fs.existsSync(target)) {
    throw new Error('Unbound working copy requires reconciliation');
  }
  // No dirty files are moved/copied from the owner's current checkout.
  git(project.path, ['worktree', 'add', '-b', branch, target, project.commit]);
  fs.chmodSync(target, 0o700);
  const binding = {
    version: 1,
    path: target,
    branch,
    projectId: project.id,
    projectFingerprint: project.fingerprint,
    baseCommit: project.commit,
  };
  writeDurableJson(bindingFile, binding);
  return binding;
}
module.exports = { git, gitArgs, projectCatalog, prepareWorkspace };
