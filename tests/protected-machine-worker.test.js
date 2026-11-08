'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const runner=require('../src/protected-configured-runner');
const id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const travail={bail:{connexion:id('1'),demande:id('2'),bail:id('3')},selection:{agent:'agent',provider:'api-compatible-explicite',modele:'modele'},
  liaison:{projet:id('4'),agent:`agent:${id('5')}`},octets:Buffer.from(JSON.stringify({metadata:{runId:id('6')}}))};
const options={fichierConfiguration:'/tmp/config',socket:'/tmp/socket',docker:'/usr/bin/docker',repertoire:'/tmp/journal',limiteAppels:1};
test('contrôle les droits avant chaque étape et ne change pas le modèle sélectionné',async()=>{
  const ancien=runner.executerAgentAvecApiProtegee;const ordre=[];
  try {
    runner.executerAgentAvecApiProtegee=async input=>{ordre.push('runtime');assert.deepEqual(input.selection,travail.selection);
      assert.equal(input.runtime,'api-compatible-local-v1');await input.verifierDroits();
      await input.suivi.avant(input.signal);await input.suivi.apres({etat:'mesure',entree:2,sortie:1},input.signal);
      return {statut:'termine',texte:'réponse'};};
    delete require.cache[require.resolve('../src/protected-machine-worker')];
    const { traiterTravailMachine }=require('../src/protected-machine-worker');
    let appel;
    const client={prendre:async()=>travail,verifier:async()=>{ordre.push('droits');return true;},
      reserver:async(_b,a)=>{appel=a;ordre.push('réservation');return true;},
      enregistrerUsage:async(_b,a,u)=>{assert.equal(a,appel);assert.deepEqual(u,{etat:'mesure',entree:2,sortie:1});ordre.push('usage');return true;},
      terminer:async(b,r)=>{assert.deepEqual(b,travail.bail);assert.equal(r.texte,'réponse');ordre.push('fin');return true;}};
    assert.deepEqual(await traiterTravailMachine({...options,client,signal:new AbortController().signal}),{statut:'termine'});
    assert.deepEqual(ordre,['droits','runtime','droits','droits','réservation','usage','droits','fin']);
  } finally {runner.executerAgentAvecApiProtegee=ancien;delete require.cache[require.resolve('../src/protected-machine-worker')];}
});
test('ne publie ni ne relance si les droits sont retirés',async()=>{
  const ancien=runner.executerAgentAvecApiProtegee;let droits=0,fin=0,executions=0;
  try {
    runner.executerAgentAvecApiProtegee=async input=>{executions++;await input.verifierDroits();return {statut:'termine',texte:'x'};};
    delete require.cache[require.resolve('../src/protected-machine-worker')];
    const { traiterTravailMachine }=require('../src/protected-machine-worker');
    const client={prendre:async()=>travail,verifier:async()=>++droits===1,reserver:async()=>true,enregistrerUsage:async()=>true,terminer:async()=>{fin++;return true;}};
    await assert.rejects(traiterTravailMachine({...options,client,signal:new AbortController().signal}),/protected_machine_unavailable/);
    assert.equal(executions,1);assert.equal(fin,0);
  } finally {runner.executerAgentAvecApiProtegee=ancien;delete require.cache[require.resolve('../src/protected-machine-worker')];}
});
