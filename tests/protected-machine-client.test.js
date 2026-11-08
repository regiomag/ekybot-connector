'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const { creerClientMachineProtegee }=require('../src/protected-machine-client');
const id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const connexion=id('a'),demande=id('3'),bail=id('b');
const message={contrat:1,requestId:demande,messageId:id('4'),channelId:id('5'),agentId:`agent:${id('2')}`,
  intention:'contexte',langue:'fr',metadata:{projectId:id('1'),runId:id('6')},donnees:{contrat:1,
    retrouver_dans_bmt:'https://www.bemytalent.com/app/agent-reference',
    capacites:{lectures:['contexte_v1'],demandes_libres_bmt:false,pieces:false,ecritures:false,paie:false},
    dossier:{reference:id('7'),devise:'CHF'}}};
const task={statut:'travail',connexion,demande,bail,selection:{agent:'agent-interne',provider:'api-compatible-explicite',modele:'modele'},
  liaison:{projet:id('1'),agent:`agent:${id('2')}`},message};
const json=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
test('isole le bail, l’agent local et la clé du contenu envoyé au runtime',async()=>{
  const appels=[];
  const client=creerClientMachineProtegee({origine:'https://eky.example.test',obtenirCleMachine:async()=>`ekm_${'a'.repeat(48)}`,
    envoyer:async(url,options)=>{const body=JSON.parse(options.body);appels.push({url,body,options});
      return json(body.action==='prendre'?task:body.action==='verifier'?{autorise:true}:{enregistre:true});}});
  const signal=new AbortController().signal,t=await client.prendre(signal);
  assert.ok(t);assert.equal(t.bail.demande,demande);assert.ok(!t.octets.toString().includes('agent-interne'));
  assert.ok(!t.octets.toString().includes('ekm_'));assert.equal(await client.verifier(t.bail,signal),true);
  assert.equal(await client.terminer(t.bail,{statut:'termine',texte:'réponse'},signal),true);
  assert.ok(appels.every(a=>a.url==='https://eky.example.test/api/companion/protected/tasks' && a.options.redirect==='error'));
  assert.ok(appels.every(a=>!JSON.stringify(a.body).includes('ekm_')));
});
test('refuse une autre liaison, un agent classique et les erreurs sans repli',async()=>{
  assert.throws(()=>creerClientMachineProtegee({origine:'https://a.test/path',obtenirCleMachine:async()=>''}),/protected_machine_unavailable/);
  const creer=sortie=>creerClientMachineProtegee({origine:'https://eky.example.test',obtenirCleMachine:async()=>`ekm_${'a'.repeat(48)}`,envoyer:async()=>json(sortie)});
  await assert.rejects(creer({...task,liaison:{...task.liaison,projet:id('9')}}).prendre(new AbortController().signal),/protected_machine_unavailable/);
  await assert.rejects(creer({...task,selection:{...task.selection,provider:'codex'}}).prendre(new AbortController().signal),/protected_machine_unavailable/);
  await assert.rejects(creer({autorise:false}).verifier({connexion,demande,bail},new AbortController().signal),/protected_machine_unavailable/);
});
