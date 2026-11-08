'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp,writeFile,chmod,symlink,rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chargerModeleProtege } = require('../src/protected-model-selection');
const agent={agent:'agent-interne',provider:'api-compatible-explicite',modele:'modele-choisi',
  endpoint:'https://exemple.test/v1/chat/completions',limite:100,parametreLimite:'max_tokens',variableCle:'CLE_MODELE'};
const selection={agent:agent.agent,provider:agent.provider,modele:agent.modele};
test('associe la configuration privée au seul agent et modèle sélectionnés',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'protection-modele-'));const path=join(dir,'config.json');
  try {
    await writeFile(path,JSON.stringify({version:1,agents:[agent]}),{mode:0o600});
    const config=await chargerModeleProtege(path,selection,{CLE_MODELE:'secret-fictif'});
    assert.equal(config.configuration.modele,selection.modele);assert.equal(await config.obtenirCle(),'secret-fictif');
    assert.ok(!JSON.stringify(config.configuration).includes('secret-fictif'));
    await assert.rejects(chargerModeleProtege(path,{...selection,modele:'autre'},{CLE_MODELE:'secret-fictif'}),/protected_model_unavailable/);
    await assert.rejects(chargerModeleProtege(path,{...selection,provider:'codex'},{CLE_MODELE:'secret-fictif'}),/protected_model_unavailable/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('refuse les fichiers non privés, liens symboliques, doublons et secrets manquants',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'protection-modele-'));const path=join(dir,'config.json');
  try {
    await writeFile(path,JSON.stringify({version:1,agents:[agent]}),{mode:0o600});
    const config=await chargerModeleProtege(path,selection,{});
    await assert.rejects(config.obtenirCle(),/protected_model_unavailable/);
    await symlink(path,join(dir,'lien'));
    await assert.rejects(chargerModeleProtege(join(dir,'lien'),selection,{}),/protected_model_unavailable/);
    await chmod(path,0o644);await assert.rejects(chargerModeleProtege(path,selection,{}),/protected_model_unavailable/);
    await chmod(path,0o600);await writeFile(path,JSON.stringify({version:1,agents:[agent,agent]}));
    await assert.rejects(chargerModeleProtege(path,selection,{}),/protected_model_unavailable/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
