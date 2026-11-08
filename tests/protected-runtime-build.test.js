'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const { readdir,readFile,rm,stat }=require('node:fs/promises');
const { join }=require('node:path');
const { preparerContexteRuntime }=require('../src/protected-runtime-build');
test('prépare un contexte minimal avec une image de base immuable, sans appel réseau',async()=>{
  const base=`sha256:${'a'.repeat(64)}`;const resultat=await preparerContexteRuntime(base);
  try {
    assert.deepEqual((await readdir(resultat.chemin)).sort(),['Dockerfile','protected-local-contract.js','worker.js']);
    const dockerfile=await readFile(join(resultat.chemin,'Dockerfile'),'utf8');
    assert.ok(dockerfile.startsWith(`FROM node@${base}\n`));assert.match(dockerfile,/USER 65534:65534/);
    assert.equal((dockerfile.match(/COPY --chown=65534:65534 /g) || []).length,2);
    for(const nom of ['Dockerfile','worker.js','protected-local-contract.js']) {
      assert.equal((await stat(join(resultat.chemin,nom))).mtimeMs,0);
    }
    assert.deepEqual(Object.keys(resultat.manifest).sort(),['baseImage','contrat','dockerfile','travailleur','version']);
  } finally {await rm(resultat.chemin,{recursive:true,force:true});}
  for(const baseInvalide of ['node:latest',`${base}\nRUN echo a`,'https://exemple.test/']){
    await assert.rejects(preparerContexteRuntime(baseInvalide),/protected_runtime_unavailable/);
  }
});
