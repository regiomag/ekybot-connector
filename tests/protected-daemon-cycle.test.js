'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cycleCompagnon } = require('../src/protected-daemon-cycle');

test('récupère avant une panne de connexion du compagnon',async()=>{
  const actions=[];
  await assert.rejects(cycleCompagnon({protege:true,signal:new AbortController().signal,
    reprendre:async()=>{actions.push('reprise');},reconcilier:async()=>{actions.push('reseau');throw new Error('offline');},
    travailler:async()=>{actions.push('travail');}}),/offline/);
  assert.deepEqual(actions,['reprise','reseau']);
});

test('continue le cycle classique mais refuse tout travail protégé si la reprise échoue',async()=>{
  const actions=[];
  await assert.rejects(cycleCompagnon({protege:true,signal:new AbortController().signal,
    reprendre:async()=>{actions.push('reprise');throw new Error('secret');},reconcilier:async()=>{actions.push('classique');},
    travailler:async()=>{actions.push('travail');}}),{message:'protected_recovery_unavailable'});
  assert.deepEqual(actions,['reprise','classique']);
});

test('le parcours fermé ne fait aucune opération protégée',async()=>{
  const actions=[];
  await cycleCompagnon({protege:false,signal:new AbortController().signal,
    reprendre:async()=>{actions.push('reprise');},reconcilier:async()=>{actions.push('classique');},
    travailler:async()=>{actions.push('travail');}});
  assert.deepEqual(actions,['classique']);
});
