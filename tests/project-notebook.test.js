const test = require('node:test');
const assert = require('node:assert/strict');
const { projectNotebook, combineExtensions } = require('../src/project-notebook');
test('notebook tools never accept a model-supplied owner or project', async () => {
  const calls = [];
  const notes = projectNotebook(async (...args) => {
    calls.push(args);
    return { ok: true };
  });
  for (const extension of notes.extensions) {
    assert.equal(extension.tool.inputSchema.additionalProperties, false);
    assert.equal(extension.tool.inputSchema.properties.projectId, undefined);
  }
  await notes.extensions[0].execute({ query: 'decision' });
  await notes.extensions[1].execute(
    { kind: 'decision', body: 'Synthetic fact', source: 'fixture' },
    { id: 'receipt-id' }
  );
  assert.deepEqual(calls[0], ['search', { query: 'decision' }]);
  assert.deepEqual(calls[1], [
    'propose',
    {
      kind: 'decision',
      body: 'Synthetic fact',
      source: 'fixture',
      id: 'receipt-id',
      requestId: 'receipt-id',
      revision: 0,
    },
  ]);
  assert.match(notes.instructions, /not approved/);
});
test('extensions share one broker rather than duplicate receipts or approvals', () => {
  const a = projectNotebook(() => {}),
    b = { extensions: [{ tool: { name: 'bmt' } }], instructions: 'BMT policy' };
  const all = combineExtensions(a, b, {});
  assert.equal(all.extensions.length, 3);
  assert.match(all.instructions, /BMT policy/);
});
