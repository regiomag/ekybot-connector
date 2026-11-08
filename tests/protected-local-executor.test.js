'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executerAgentLocalProtege } = require('../src/protected-local-executor');

test('un runtime non qualifié est refusé avant toute donnée ou appel au modèle', async () => {
  let appels = 0;
  await assert.rejects(executerAgentLocalProtege({ runtime: 'codex', runId: '11111111-1111-4111-8111-111111111111',
    octets: Buffer.from('secret fictif'), liaison: {}, socket: '/tmp/aucun', docker: '/usr/bin/docker',
    limiteAppels: 1, verifierDroits: async () => { appels++; }, appelerModele: async () => { appels++; } }),
  (error) => error.message === 'protected_runtime_unavailable');
  assert.equal(appels, 0);
});
