const path = require('node:path');
const { digest, PROTECTED_NAMES } = require('./development-files');
// Native profile and broker agree on the project boundary. The native session
// store is readable but never writable by model tools; only the runtime owns it.
function codexDevelopmentPolicy(root, cwd, write) {
  if (![root, cwd].every(path.isAbsolute) || root === cwd)
    throw new Error('Separate project and native state required');
  const name = `ekybot-work-${digest(root).slice(0, 16)}`;
  const rules = { ':minimal': 'read', [cwd]: 'read', [root]: write ? 'write' : 'read' };
  for (const item of PROTECTED_NAMES) rules[`${root}/**/${item}`] = 'deny';
  const overrides = { [`permissions.${name}`]: { filesystem: rules, network: { enabled: false } } };
  return {
    name,
    overrides,
    assert(config) {
      const actual = config.permissions?.[name];
      if (
        !actual ||
        actual.extends ||
        actual.network?.enabled !== false ||
        (actual.workspace_roots && Object.keys(actual.workspace_roots).length) ||
        Object.entries(actual.filesystem || {}).some(
          ([key, value]) => !(key in rules) && value !== null
        ) ||
        Object.entries(rules).some(([key, value]) => actual.filesystem[key] !== value)
      )
        throw new Error('Development permission profile changed');
    },
  };
}
module.exports = { codexDevelopmentPolicy };
