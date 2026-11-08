'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const { mkdtemp,writeFile,readFile,rm }=require('node:fs/promises');
const { tmpdir }=require('node:os');
const { join }=require('node:path');
const { construire }=require('../scripts/construire-runtime-reproductible');

test('la construction ne remplace pas une archive déjà présente',async()=>{
  const repertoire=await mkdtemp(join(tmpdir(),'bmt-repro-test-'));
  const archive=join(repertoire,'image.tar');
  try {
    await writeFile(archive,'archive existante');
    await assert.rejects(construire('/usr/bin/docker','/socket-fictif','/buildx-fictif',archive),/runtime_build_unavailable/);
    assert.equal(await readFile(archive,'utf8'),'archive existante');
  } finally {await rm(repertoire,{recursive:true,force:true});}
});
