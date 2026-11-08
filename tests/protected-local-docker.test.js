'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nettoyerConteneurProtege } = require('../src/protected-local-docker');
const run='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',nom=`bmt-protected-${run}`;
test('arrête exclusivement le conteneur concerné et vérifie le résultat',async()=>{
  let etat=nom,arrets=0;
  const port={identite:async()=>'daemon-1',lister:async cible=>{assert.equal(cible,nom);return etat;},
    arreter:async cible=>{assert.equal(cible,nom);arrets++;etat='';}};
  assert.equal(await nettoyerConteneurProtege(run,'daemon-1',port),true);assert.equal(arrets,1);
  assert.equal(await nettoyerConteneurProtege(run,'daemon-1',port),true);assert.equal(arrets,1);
});
test('refuse une identité changée, un conteneur différent ou un arrêt non confirmé',async()=>{
  const port={identite:async()=>'autre',lister:async()=>nom,arreter:async()=>{}};
  await assert.rejects(nettoyerConteneurProtege(run,'daemon-1',port),/protected_recovery_unavailable/);
  port.identite=async()=>'daemon-1';port.lister=async()=>`${nom}\nautre`;
  await assert.rejects(nettoyerConteneurProtege(run,'daemon-1',port),/protected_recovery_unavailable/);
  port.lister=async()=>nom;
  await assert.rejects(nettoyerConteneurProtege(run,'daemon-1',port),/protected_recovery_unavailable/);
  await assert.rejects(nettoyerConteneurProtege('nom-arbitraire','daemon-1',port),/protected_recovery_unavailable/);
});
