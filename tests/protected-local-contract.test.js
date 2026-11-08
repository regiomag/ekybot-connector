'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifierMessageLocalProtege } = require('../src/protected-local-contract');
const id = (x) => `${x.repeat(8)}-${x.repeat(4)}-4${x.repeat(3)}-8${x.repeat(3)}-${x.repeat(12)}`;
const liaison = { projet: id('1'), agent: `agent:${id('2')}` };
const message = { contrat: 1, requestId: id('3'), messageId: id('4'), channelId: id('5'), agentId: liaison.agent,
  intention: 'contexte', langue: 'fr', metadata: { projectId: liaison.projet, runId: id('6') },
  donnees: { contrat: 1, retrouver_dans_bmt: 'https://www.bemytalent.com/app/agent-reference',
    capacites: { lectures: ['contexte_v1'], demandes_libres_bmt: false, pieces: false, ecritures: false, paie: false },
    dossier: { reference: id('7'), devise: 'CHF' } } };
const bytes = (x) => Buffer.from(JSON.stringify(x));
test('ne laisse passer que les données structurées pour la liaison choisie', () => {
  assert.deepEqual(verifierMessageLocalProtege(bytes(message), liaison), message);
  for (const value of [{ ...message, texte: 'Nom fictif' }, { ...message, attachments: [] },
    { ...message, metadata: { ...message.metadata, projectId: id('8') } },
    { ...message, donnees: { ...message.donnees, dossier: { ...message.donnees.dossier, nom: 'Nom fictif' } } }]) {
    assert.throws(() => verifierMessageLocalProtege(bytes(value), liaison), /protected_runtime_unavailable/);
  }
});
