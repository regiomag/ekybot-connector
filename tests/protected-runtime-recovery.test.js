'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recupererRuntimeInterrompu } = require('../src/protected-runtime-recovery');

test('récupère les travaux avant toute demande et ferme les ressources', async () => {
  const actions=[];
  const nettoyer=()=>{};
  await recupererRuntimeInterrompu({docker:'docker',socket:'socket',repertoire:'rep'}, {
    ouvrirDocker:async () => ({identite:'demon',nettoyer,fermer:async()=>{actions.push('docker');}}),
    ouvrirJournal:async (options) => {
      assert.equal(options.identiteDemon,'demon');assert.equal(options.nettoyer,nettoyer);
      return {recuperer:async()=>{actions.push('reprise');},fermer:async()=>{actions.push('journal');}};
    },
  });
  assert.deepEqual(actions,['reprise','journal','docker']);
});

test('une reprise incertaine échoue sans exposer les détails et ferme les ressources', async () => {
  const actions=[];
  await assert.rejects(recupererRuntimeInterrompu({}, {
    ouvrirDocker:async()=>({identite:'demon',nettoyer:()=>{},fermer:async()=>{actions.push('docker');}}),
    ouvrirJournal:async()=>({recuperer:async()=>{throw new Error('secret');},fermer:async()=>{actions.push('journal');}}),
  }), {message:'protected_recovery_unavailable'});
  assert.deepEqual(actions,['journal','docker']);
});
