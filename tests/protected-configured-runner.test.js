'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sandbox=require('../src/protected-local-sandbox');
const executor=require('../src/protected-local-executor');
const docker=require('../src/protected-local-docker');
const journalModule=require('../src/protected-local-journal');
const run='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const liaison={projet:id('1'),agent:`agent:${id('2')}`};
const message={contrat:1,requestId:id('3'),messageId:id('4'),channelId:id('5'),agentId:liaison.agent,
  intention:'contexte',langue:'fr',metadata:{projectId:liaison.projet,runId:run},donnees:{contrat:1,
    retrouver_dans_bmt:'https://www.bemytalent.com/app/agent-reference',
    capacites:{lectures:['contexte_v1'],demandes_libres_bmt:false,pieces:false,ecritures:false,paie:false},
    dossier:{reference:id('7'),devise:'CHF'}}};
const configuration={mode:'api-compatible-explicite',endpoint:'https://modele.example.test/v1/chat/completions',
  modele:'modele-localement-choisi',limite:100,parametreLimite:'max_tokens'};

test('raccorde le transport à l’exécution seulement après journalisation, puis confirme l’arrêt',async()=>{
  const old={plan:sandbox.planProtectedLocalRuntime,exec:executor.executerAgentLocalProtege,
    docker:docker.ouvrirDockerProtege,journal:journalModule.ouvrirJournalProtege,fetch:global.fetch};
  const ordre=[];const lock=new AbortController();let envoi;
  try {
    sandbox.planProtectedLocalRuntime=()=>[];
    docker.ouvrirDockerProtege=async()=>({identite:'demon-fictif',nettoyer:async()=>true,fermer:async()=>ordre.push('demon-ferme')});
    journalModule.ouvrirJournalProtege=async()=>({signal:lock.signal,recuperer:async()=>ordre.push('recuperer'),
      enregistrer:async()=>ordre.push('inscrit'),terminer:async()=>ordre.push('arrete'),fermer:async()=>ordre.push('journal-ferme')});
    global.fetch=async(url,options)=>{envoi={url,options};return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'réponse'}}]}),
      {headers:{'content-type':'application/json'}});};
    executor.executerAgentLocalProtege=async options=>{ordre.push('exec');assert.ok(ordre.includes('inscrit'));
      assert.ok(!JSON.stringify(options.liaison).includes('cle-fictive'));
      return {texte:await options.appelerModele('question pseudonymisée',options.signal)};};
    delete require.cache[require.resolve('../src/protected-configured-runner')];
    const { executerAgentAvecApiProtegee }=require('../src/protected-configured-runner');
    const resultat=await executerAgentAvecApiProtegee({configuration,obtenirCle:async()=>'cle-fictive',runtime:'fictif',runId:run,
      octets:Buffer.from(JSON.stringify(message)),liaison,socket:'/tmp/fictif',docker:'/usr/bin/docker',repertoire:'/tmp/fictif',
      verifierDroits:async()=>{},limiteAppels:1,signal:new AbortController().signal});
    assert.deepEqual(resultat,{statut:'termine',texte:'réponse'});
    assert.deepEqual(ordre,['recuperer','inscrit','exec','arrete','journal-ferme','demon-ferme']);
    assert.equal(envoi.url,configuration.endpoint);assert.equal(JSON.parse(envoi.options.body).model,configuration.modele);
    assert.ok(!envoi.options.body.includes('cle-fictive'));
  } finally {
    sandbox.planProtectedLocalRuntime=old.plan;executor.executerAgentLocalProtege=old.exec;docker.ouvrirDockerProtege=old.docker;
    journalModule.ouvrirJournalProtege=old.journal;global.fetch=old.fetch;delete require.cache[require.resolve('../src/protected-configured-runner')];
  }
});
test('une absence non vérifiable reste incertaine et conserve le journal',async()=>{
  const old={plan:sandbox.planProtectedLocalRuntime,exec:executor.executerAgentLocalProtege,
    docker:docker.ouvrirDockerProtege,journal:journalModule.ouvrirJournalProtege};
  let abandonne=false;const lock=new AbortController();
  try {
    sandbox.planProtectedLocalRuntime=()=>[];
    docker.ouvrirDockerProtege=async()=>({identite:'demon',nettoyer:async()=>false,fermer:async()=>{}});
    journalModule.ouvrirJournalProtege=async()=>({signal:lock.signal,recuperer:async()=>{},enregistrer:async()=>{},
      terminer:async()=>{throw new Error();},abandonner:()=>{abandonne=true;},fermer:async()=>{}});
    executor.executerAgentLocalProtege=async()=>{throw new Error('protected_runtime_stop_unconfirmed');};
    delete require.cache[require.resolve('../src/protected-configured-runner')];
    const { executerAgentAvecApiProtegee }=require('../src/protected-configured-runner');
    await assert.rejects(executerAgentAvecApiProtegee({configuration,obtenirCle:async()=>'cle',runtime:'fictif',runId:run,
      octets:Buffer.from(JSON.stringify(message)),liaison,socket:'/tmp/fictif',docker:'/usr/bin/docker',repertoire:'/tmp/fictif',
      verifierDroits:async()=>{},limiteAppels:1,signal:new AbortController().signal}),/protected_runtime_unavailable/);
    assert.equal(abandonne,true);
  } finally {
    sandbox.planProtectedLocalRuntime=old.plan;executor.executerAgentLocalProtege=old.exec;docker.ouvrirDockerProtege=old.docker;
    journalModule.ouvrirJournalProtege=old.journal;delete require.cache[require.resolve('../src/protected-configured-runner')];
  }
});
