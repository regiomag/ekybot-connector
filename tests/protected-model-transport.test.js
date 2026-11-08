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
test('refuse les redirections, sorties non bornées, outils et erreurs du fournisseur sans révéler les secrets',async()=>{
  for(const sortie of [new Response('x'.repeat(100000),{headers:{'content-type':'application/json'}}),
    new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'x',tool_calls:[{}]}}]}),{headers:{'content-type':'application/json'}}),
    new Response('privé',{status:401,headers:{'content-type':'text/plain'}})]) {
    const t=creerTransportModeleProtege({configuration:config,obtenirCle:async()=>'secret-fictif',envoyer:async()=>sortie});
    await assert.rejects(t('question',signal()),e=>e.message==='protected_model_unavailable');
  }
});
