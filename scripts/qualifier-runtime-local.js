'use strict';

// Exécution manuelle sur un démon de qualification dédié. L'image doit déjà
// être présente ; ce script ne télécharge rien et n'ouvre aucune gate.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const { join,isAbsolute } = require('node:path');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const sandbox = require('../src/protected-local-sandbox');

async function qualifier(socket,image,docker) {
  if (typeof socket!=='string' || !isAbsolute(socket) || !/^sha256:[0-9a-f]{64}$/.test(image)
    || !['/usr/bin/docker','/usr/local/bin/docker','/opt/homebrew/bin/docker'].includes(docker)) {throw new Error('qualification_invalide');}
  const planOriginal=sandbox.planProtectedLocalRuntime;
  sandbox.planProtectedLocalRuntime=(_runtime,runId)=>sandbox.buildIsolatedContainerArgs(runId,image);
  const {executerAgentAvecApiProtegee}=require('../src/protected-configured-runner');
  const repertoire=await fs.mkdtemp(join(require('node:os').tmpdir(),'bmt-runtime-qualification-'));
  const [projet,agent,request,message,channel,runId,dossier]=Array.from({length:7},()=>randomUUID());
  const liaison={projet,agent:`agent:${agent}`};
  const contenu={contrat:1,requestId:request,messageId:message,channelId:channel,agentId:liaison.agent,
    intention:'contexte',langue:'fr',metadata:{projectId:projet,runId},donnees:{contrat:1,
      retrouver_dans_bmt:'https://www.bemytalent.com/app/agent-reference',
      capacites:{lectures:['contexte_v1'],demandes_libres_bmt:false,pieces:false,ecritures:false,paie:false},
      dossier:{reference:dossier,devise:'CHF'}}};
  let appels=0,question='';
  const service=http.createServer(async(req,res)=>{
    try {
      const morceaux=[];for await(const bloc of req) {morceaux.push(bloc);}
      const body=JSON.parse(Buffer.concat(morceaux).toString('utf8'));
      if(req.headers.authorization || body.model!=='modele-fictif') {throw new Error();}
      question=body.messages[0].content;appels++;
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({model:'modele-fictif',choices:[{message:{role:'assistant',content:'Réponse locale fictive.'}}]}));
    } catch {res.writeHead(400);res.end();}
  });
  try {
    service.listen(0,'127.0.0.1');await once(service,'listening');
    const fichierConfiguration=join(repertoire,'modele.json');
    await fs.writeFile(fichierConfiguration,JSON.stringify({version:1,agents:[{agent:'agent-test',provider:'api-compatible-explicite',
      modele:'modele-fictif',endpoint:`http://127.0.0.1:${service.address().port}/v1/chat/completions`,limite:100,
      parametreLimite:'max_tokens',variableCle:null}]}),{mode:0o600});
    let controles=0;const suivi={avant:async()=>{},apres:async usage=>assert.equal(usage.etat,'inconnu')};
    const resultat=await executerAgentAvecApiProtegee({fichierConfiguration,selection:{agent:'agent-test',provider:'api-compatible-explicite',modele:'modele-fictif'},
      runtime:'qualification',runId,octets:Buffer.from(JSON.stringify(contenu)),liaison,socket,
      docker,repertoire:join(repertoire,'journal'),
      verifierDroits:async()=>{controles++;},suivi,limiteAppels:1,delaiMs:60000,signal:AbortSignal.timeout(75000)});
    assert.deepEqual(resultat,{statut:'termine',texte:'Réponse locale fictive.'});
    assert.equal(appels,1);assert.ok(controles>=4);assert.ok(question.includes(dossier));
    assert.deepEqual((await fs.readdir(join(repertoire,'journal'))).filter(v=>v.startsWith('run-')),[]);
    process.stdout.write('Exécution locale et nettoyage vérifiés avec des données fictives.\n');
  } finally {
    sandbox.planProtectedLocalRuntime=planOriginal;
    service.closeAllConnections();await new Promise(resolve=>service.close(resolve));
    await fs.rm(repertoire,{recursive:true,force:true});
  }
}

if(require.main===module) {
  qualifier(process.argv[2],process.argv[3],process.argv[4]).catch(()=>{process.stderr.write('Qualification locale impossible.\n');process.exitCode=1;});
}
