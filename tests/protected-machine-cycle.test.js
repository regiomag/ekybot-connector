'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const clientModule=require('../src/protected-machine-client');
const workerModule=require('../src/protected-machine-worker');
test('raccorde le cycle à la machine locale sans exposer sa clé au travailleur',async()=>{
  const ancien={client:clientModule.creerClientMachineProtegee,worker:workerModule.traiterTravailMachine};let choix;
  try {
    clientModule.creerClientMachineProtegee=options=>{choix=options;return {marque:'client'};};
    workerModule.traiterTravailMachine=async options=>{
      assert.equal(options.client.marque,'client');assert.ok(!JSON.stringify(options).includes('cle-fictive'));
      return {statut:'vide'};
    };
    delete require.cache[require.resolve('../src/protected-machine-cycle')];
    const {cycleMachineProtegee}=require('../src/protected-machine-cycle');
    assert.deepEqual(await cycleMachineProtegee({etat:{baseUrl:'https://eky.example.test/',machineApiKey:'cle-fictive'},
      reglages:{fichierConfiguration:'/tmp/fictif',socket:'/tmp/sock',docker:'/usr/bin/docker',repertoire:'/tmp/dir',limiteAppels:1},
      signal:new AbortController().signal}),{statut:'vide'});
    assert.equal(choix.origine,'https://eky.example.test');assert.equal(await choix.obtenirCleMachine(),'cle-fictive');
  } finally {clientModule.creerClientMachineProtegee=ancien.client;workerModule.traiterTravailMachine=ancien.worker;
    delete require.cache[require.resolve('../src/protected-machine-cycle')];}
});
