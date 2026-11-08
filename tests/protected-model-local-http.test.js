'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { creerTransportModeleProtege } = require('../src/protected-model-transport');

test('échange des données fictives avec un service local sans clé ni redirection',async()=>{
  let recu;
  const serveur=http.createServer(async(req,res)=>{
    const blocs=[];for await(const bloc of req) {blocs.push(bloc);}
    recu={authorization:req.headers.authorization,corps:JSON.parse(Buffer.concat(blocs).toString('utf8'))};
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({model:'fictif',choices:[{message:{role:'assistant',content:'Réponse locale fictive'}}]}));
  });
  try {
    serveur.listen(0,'127.0.0.1');await once(serveur,'listening');
    const port=serveur.address().port;
    const transport=creerTransportModeleProtege({configuration:{mode:'api-compatible-explicite',
      endpoint:`http://127.0.0.1:${port}/v1/chat/completions`,modele:'fictif',limite:100,parametreLimite:'max_tokens'},obtenirCle:async()=>null});
    assert.equal(await transport('Question fictive',new AbortController().signal),'Réponse locale fictive');
    assert.equal(recu.authorization,undefined);
    assert.equal(recu.corps.messages[0].content,'Question fictive');
  } finally {serveur.closeAllConnections();await new Promise(resolve=>serveur.close(resolve));}
});
