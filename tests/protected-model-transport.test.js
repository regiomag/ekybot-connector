'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { creerTransportModeleProtege } = require('../src/protected-model-transport');
const config = { mode:'api-compatible-explicite', endpoint:'https://modele.example.test/v1/chat/completions',
  modele:'modele-selectionne',limite:100,parametreLimite:'max_tokens' };
const signal = () => new AbortController().signal;
const reponse = (texte) => new Response(JSON.stringify({choices:[{message:{role:'assistant',content:texte}}]}),
  {status:200,headers:{'content-type':'application/json'}});
test('transmet seulement au modèle et à la destination configurés localement, sans laisser choisir le conteneur',async()=>{
  let appel;
  const transport=creerTransportModeleProtege({configuration:config,obtenirCle:async()=>'cle-fictive',envoyer:async(url,options)=>{
    appel={url,options};return reponse('Réponse fictive');
  }});
  assert.equal(await transport('Question pseudonymisée',signal()),'Réponse fictive');
  assert.equal(appel.url,config.endpoint);assert.equal(appel.options.redirect,'error');
  assert.equal(appel.options.headers.Authorization,'Bearer cle-fictive');
  assert.deepEqual(JSON.parse(appel.options.body),{model:'modele-selectionne',messages:[{role:'user',content:'Question pseudonymisée'}],stream:false,max_tokens:100});
  assert.ok(!appel.options.body.includes('cle-fictive'));
});
test('refuse une configuration implicite, les destinations invalides et les dépassements sans appeler le fournisseur',async()=>{
  let appels=0;const envoyer=async()=>{appels++;return reponse('x');};
  for(const modification of [{mode:'codex'}, {endpoint:'http://exemple.test/v1/chat/completions'},
    {endpoint:'https://user:pass@exemple.test/v1/chat/completions'}, {endpoint:'https://exemple.test/v1/chat/completions?secret=1'},
    {limite:9000}, {parametreLimite:'autre'}]) {
    assert.throws(()=>creerTransportModeleProtege({configuration:{...config,...modification},obtenirCle:async()=>'x',envoyer}),/protected_model_unavailable/);
  }
  const t=creerTransportModeleProtege({configuration:config,obtenirCle:async()=>'x',envoyer});
  await assert.rejects(t('x'.repeat(65537),signal()),/protected_model_unavailable/);assert.equal(appels,0);
});
test('accepte un modèle local explicitement configuré sans autoriser les autres adresses HTTP',async()=>{
  let destination;
  const envoyer=async url=>{destination=url;return reponse('réponse locale');};
  for(const endpoint of ['http://127.0.0.1:11434/v1/chat/completions','http://[::1]:11434/v1/chat/completions']) {
    const t=creerTransportModeleProtege({configuration:{...config,endpoint},obtenirCle:async()=>'cle-locale',envoyer});
    assert.equal(await t('Question',signal()),'réponse locale');assert.equal(destination,endpoint);
  }
  let entetes;
  const sansCle=creerTransportModeleProtege({configuration:{...config,endpoint:'http://127.0.0.1:11434/v1/chat/completions'},
    obtenirCle:async()=>null,envoyer:async(_url,options)=>{entetes=options.headers;return reponse('locale');}});
  assert.equal(await sansCle('Question',signal()),'locale');assert.equal(entetes.Authorization,undefined);
  const distant=creerTransportModeleProtege({configuration:config,obtenirCle:async()=>null,envoyer});
  await assert.rejects(distant('Question',signal()),/protected_model_unavailable/);
  for(const endpoint of ['http://localhost:11434/v1/chat/completions','http://127.0.0.2/v1/chat/completions',
    'http://2130706433/v1/chat/completions','http://192.168.1.2/v1/chat/completions',
    'http://127.0.0.1@exemple.test/v1/chat/completions']) {
    assert.throws(()=>creerTransportModeleProtege({configuration:{...config,endpoint},obtenirCle:async()=>'x',envoyer}),/protected_model_unavailable/);
  }
});
test('refuse les redirections, sorties non bornées, outils et erreurs du fournisseur sans révéler les secrets',async()=>{
  for(const sortie of [new Response('x'.repeat(100000),{headers:{'content-type':'application/json'}}),
    new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'x',tool_calls:[{}]}}]}),{headers:{'content-type':'application/json'}}),
    new Response('privé',{status:401,headers:{'content-type':'text/plain'}})]) {
    const t=creerTransportModeleProtege({configuration:config,obtenirCle:async()=>'secret-fictif',envoyer:async()=>sortie});
    await assert.rejects(t('question',signal()),e=>e.message==='protected_model_unavailable');
  }
});
test('réserve avant l’appel et conserve des compteurs bornés sans supposer un coût',async()=>{
  const ordre=[];
  const t=creerTransportModeleProtege({configuration:config,obtenirCle:async()=>'cle',
    suivi:{avant:async()=>ordre.push('réservation'),apres:async usage=>ordre.push(usage)},
    envoyer:async()=>{ordre.push('appel');return new Response(JSON.stringify({usage:{prompt_tokens:12,completion_tokens:3,total_tokens:15},
      choices:[{message:{role:'assistant',content:'ok'}}]}),{headers:{'content-type':'application/json'}});}});
  assert.equal(await t('question',signal()),'ok');
  assert.deepEqual(ordre,['réservation','appel',{etat:'mesure',entree:12,sortie:3}]);
  const refuse=creerTransportModeleProtege({configuration:config,obtenirCle:async()=>'cle',
    suivi:{avant:async()=>{throw new Error();},apres:async()=>{}},envoyer:async()=>{throw new Error('doit rester fermé');}});
  await assert.rejects(refuse('question',signal()),/protected_model_unavailable/);
});
test('un fournisseur sans compteurs ou avec des compteurs incohérents ne donne pas un faux zéro',async()=>{
  const {mesurerUsage}=require('../src/protected-model-transport');
  for(const usage of [undefined,{}, {prompt_tokens:0,completion_tokens:1,total_tokens:0},
    {prompt_tokens:-1,completion_tokens:0}, {prompt_tokens:1,completion_tokens:9000}]) {
    assert.deepEqual(mesurerUsage(usage),{etat:'inconnu'});
  }
});
test('enregistre les compteurs même lorsque la réponse du modèle est rejetée',async()=>{
  let observation;
  const t=creerTransportModeleProtege({configuration:config,obtenirCle:async()=>'cle',
    suivi:{avant:async()=>{},apres:async usage=>{observation=usage;}},envoyer:async()=>
      new Response(JSON.stringify({usage:{prompt_tokens:8,completion_tokens:2,total_tokens:10},
        choices:[{message:{role:'assistant',content:'texte',tool_calls:[{}]}}]}),{headers:{'content-type':'application/json'}})});
  await assert.rejects(t('question',signal()),/protected_model_unavailable/);
  assert.deepEqual(observation,{etat:'mesure',entree:8,sortie:2});
});
