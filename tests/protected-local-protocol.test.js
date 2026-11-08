'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { servirProtocoleProtege } = require('../src/protected-local-protocol');
const { creerPontLocalProtege } = require('../src/protected-local-broker');
const id = '11111111-1111-4111-8111-111111111111';
function sortie() {
  const morceaux = [];
  return { flux: new Writable({ write(chunk, _encoding, cb) { morceaux.push(chunk); cb(); } }),
    lire: () => Buffer.concat(morceaux).toString('utf8') };
}
test('échange local borné puis retourne seulement la réponse finale', async () => {
  const contenu = Buffer.from(`${JSON.stringify({ type: 'modele', id, question: 'Écriture fictive' })}\n${JSON.stringify({ type: 'termine', texte: 'Résultat' })}\n`);
  const entree = Readable.from([contenu.subarray(0, 29), contenu.subarray(29)]), out = sortie();
  const pont = creerPontLocalProtege({ limiteAppels: 1, appelerModele: async () => 'Calcul' });
  assert.equal(await servirProtocoleProtege(entree, out.flux, pont), 'Résultat');
  assert.deepEqual(JSON.parse(out.lire()), { type: 'modele_resultat', id, texte: 'Calcul' });
});
test('refuse messages supplémentaires, fin absente et contenu mal formé', async () => {
  const pont = async () => ({ type: 'modele_resultat', id, texte: 'OK' });
  for (const texte of ['{}\n', '{\n', `${JSON.stringify({ type: 'termine', texte: 'OK' })}\n{}\n`, 'x'.repeat(65537)]) {
    await assert.rejects(servirProtocoleProtege(Readable.from([Buffer.from(texte)]), sortie().flux, pont), /protected_runtime_unavailable/);
  }
});
