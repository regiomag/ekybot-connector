// Generate the shared permission/effect snapshot from BMT, never maintain it twice.
// Usage: node scripts/sync-bmt-registry.js /absolute/bmt/checkout ref [--check]
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stripTypeScriptTypes } = require('node:module');
const [repo, ref, check] = process.argv.slice(2);
if (!path.isAbsolute(repo || '') || !ref || ref.startsWith('-') || (check && check !== '--check')) {
  throw new Error('Explicit BMT checkout and revision required');
}
const revision = execFileSync('git', ['rev-parse', `${ref}^{commit}`], {
  cwd: repo,
  encoding: 'utf8',
}).trim();
const source = execFileSync(
  'git',
  ['show', `${revision}:supabase/functions/_shared/agent-operation-registry.ts`],
  { cwd: repo, encoding: 'utf8' }
);
const js = stripTypeScriptTypes(source).replaceAll('export ', '');
const operations = require('node:vm')
  .runInNewContext(`${js}\nAGENT_OPERATIONS;`, Object.create(null), { timeout: 1000 })
  .filter((o) => ['accounting', 'planning', 'mandates', 'crm'].includes(o.api))
  .map(({ api, action, method, scope, effect }) => ({ api, action, method, scope, effect }));
const content =
  JSON.stringify(
    {
      source: 'regiomag/bemytalent_tools',
      revision,
      excluded: ['intake: partner site credentials', 'meetings: Calenoo-specific credentials'],
      operations,
    },
    null,
    2
  ) + '\n';
const target = path.resolve(__dirname, '../src/bmt-registry.json');
if (check) {
  if (fs.readFileSync(target, 'utf8') !== content) {
    throw new Error('BMT registry snapshot drift');
  }
} else {
  fs.writeFileSync(target, content);
}
process.stdout.write(
  JSON.stringify({ revision, operations: operations.length, checked: !!check }) + '\n'
);
