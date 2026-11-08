'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { creerPontLocalProtege } = require('../src/protected-local-broker');
const id = (x) => `${x.repeat(8)}-${x.repeat(4)}-4${x.repeat(3)}-8${x.repeat(3)}-${x.repeat(12)}`;

test('le pont utilise le fournisseur choisi localement, limite et ne rejoue pas les appels', async () => {
  let appels = 0;
  const pont = creerPontLocalProtege({ limiteAppels: 1, appelerModele: async (question) => { appels++; return `Réponse : ${question}`; } });
  assert.deepEqual(await pont({ type: 'modele', id: id('1'), question: 'Données fictives' }),
    { type: 'modele_resultat', id: id('1'), texte: 'Réponse : Données fictives' });
  await assert.rejects(pont({ type: 'modele', id: id('1'), question: 'Données fictives' }), /protected_runtime_unavailable/);
  await assert.rejects(pont({ type: 'modele', id: id('2'), question: 'Autre' }), /protected_runtime_unavailable/);
  assert.equal(appels, 1);
});

test('refuse la destination et le modèle imposés par la boîte et neutralise les erreurs', async () => {
  let appels = 0;
  const pont = creerPontLocalProtege({ limiteAppels: 2, appelerModele: async () => { appels++; throw new Error('secret fictif'); } });
  await assert.rejects(pont({ type: 'modele', id: id('1'), question: 'Question', url: 'https://example.invalid' }), /protected_runtime_unavailable/);
  await assert.rejects(pont({ type: 'modele', id: id('1'), question: 'Question', model: 'autre' }), /protected_runtime_unavailable/);
  await assert.rejects(pont({ type: 'modele', id: id('1'), question: 'Question' }),
    (error) => error.message === 'protected_runtime_unavailable');
  assert.equal(appels, 1);
});

test('un appel dépassé reste occupé tant que le fournisseur ne s’est pas arrêté', async () => {
  let terminer;
  let appels = 0;
  const enAttente = new Promise((resolve) => { terminer = resolve; });
  const pont = creerPontLocalProtege({ limiteAppels: 2, delaiMs: 100,
    appelerModele: async () => { appels++; return appels === 1 ? enAttente : 'Terminé'; } });
  await assert.rejects(pont({ type: 'modele', id: id('1'), question: 'Question' }), /protected_runtime_unavailable/);
  await assert.rejects(pont({ type: 'modele', id: id('2'), question: 'Question' }), /protected_runtime_unavailable/);
  terminer('Tardif');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await pont({ type: 'modele', id: id('2'), question: 'Question' }),
    { type: 'modele_resultat', id: id('2'), texte: 'Terminé' });
  assert.equal(appels, 2);
});

test('un retrait d’autorisation annule le pont et ne permet aucun nouvel appel', async () => {
  const controle = new AbortController();
  let modeleSignal;
  const pont = creerPontLocalProtege({ limiteAppels: 2, signal: controle.signal,
    appelerModele: async (_question, signal) => { modeleSignal = signal; return await new Promise(() => {}); } });
  const appel = pont({ type: 'modele', id: id('1'), question: 'Question' });
  await new Promise((resolve) => setImmediate(resolve));
  controle.abort();
  await assert.rejects(appel, /protected_runtime_unavailable/);
  assert.equal(modeleSignal.aborted, true);
  await assert.rejects(pont({ type: 'modele', id: id('2'), question: 'Question' }), /protected_runtime_unavailable/);
});
