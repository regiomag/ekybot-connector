'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { travailler } = require('../src/protected-runtime/worker');
const { servirProtocoleProtege } = require('../src/protected-local-protocol');
const { creerPontLocalProtege } = require('../src/protected-local-broker');
const id = n => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const message={contrat:1,requestId:id('3'),messageId:id('4'),channelId:id('5'),agentId:`agent:${id('2')}`,
  intention:'contexte',langue:'fr',metadata:{projectId:id('1'),runId:id('6')},donnees:{contrat:1,
    retrouver_dans_bmt:'https://www.bemytalent.com/app/agent-reference',
    capacites:{lectures:['contexte_v1'],demandes_libres_bmt:false,pieces:false,ecritures:false,paie:false},
    dossier:{reference:id('7'),devise:'CHF'}}};
test('le runtime produit une question structurée puis restitue la réponse du modèle choisi',async()=>{
  const entree=new PassThrough(),sortie=new PassThrough();let question;
  const pont=creerPontLocalProtege({limiteAppels:1,appelerModele:async q=>{question=q;return 'Réponse fictive';}});
  const worker=travailler(entree,sortie).then(()=>sortie.end());
  const resultat=servirProtocoleProtege(sortie,entree,pont);
  entree.write(`${JSON.stringify({type:'demarrer',message})}\n`);
  assert.equal(await resultat,'Réponse fictive');await worker;entree.destroy();
  assert.match(question,/Explique le contexte/);assert.ok(question.includes(id('7')));
  assert.ok(!question.includes('agent:'));assert.ok(!question.includes(id('1')));
});
test('refuse une donnée non autorisée avant appel du modèle',async()=>{
  const entree=new PassThrough(),sortie=new PassThrough();let sortieTexte='';sortie.on('data',v=>{sortieTexte+=v;});
  const worker=travailler(entree,sortie);
  entree.end(`${JSON.stringify({type:'demarrer',message:{...message,nom:'nom interdit'}})}\n`);
  await assert.rejects(worker,/protected_runtime_unavailable/);assert.equal(sortieTexte,'');sortie.destroy();
});

test('le programme local se termine après avoir rendu sa réponse',async()=>{
  const { spawn }=require('node:child_process');
  const { once }=require('node:events');
  const enfant=spawn(process.execPath,['src/protected-runtime/worker.js'],{cwd:process.cwd(),env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','ignore']});
  const fin=once(enfant,'exit');
  try {
    const pont=creerPontLocalProtege({limiteAppels:1,appelerModele:async()=> 'réponse'});
    const resultat=servirProtocoleProtege(enfant.stdout,enfant.stdin,pont);
    enfant.stdin.write(`${JSON.stringify({type:'demarrer',message})}\n`);
    assert.equal(await resultat,'réponse');const [code]=await fin;assert.equal(code,0);
  } finally {enfant.kill('SIGKILL');}
});
