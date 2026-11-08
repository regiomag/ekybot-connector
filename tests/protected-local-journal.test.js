'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp,rm,readdir,readFile,writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { ouvrirJournalProtege } = require('../src/protected-local-journal');
const run='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('garde un journal sans données métier et récupère avant toute nouvelle exécution',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'protection-journal-test-'));let premier,second;
  const arrets=[];const options={repertoire:dir,identiteDemon:'daemon-fictif',nettoyer:async id=>{arrets.push(id);return true;}};
  try {
    premier=await ouvrirJournalProtege(options);
    await assert.rejects(premier.enregistrer(run),/protected_recovery_unavailable/);
    await premier.recuperer();await premier.enregistrer(run);
    const document=await readFile(join(dir,`run-${run}.json`),'utf8');
    assert.ok(!document.includes('daemon-fictif'));assert.deepEqual(Object.keys(JSON.parse(document)).sort(),['demon','run','version']);
    await assert.rejects(premier.fermer(),/protected_recovery_unavailable/);
    premier.abandonner(run);await premier.fermer();
    second=await ouvrirJournalProtege(options);await second.recuperer();
    assert.deepEqual(arrets,[run]);assert.deepEqual(await readdir(dir),['supervisor.lock']);
    await second.enregistrer(run);await second.terminer(run);
    assert.deepEqual(arrets,[run,run]);
  } finally {if(premier){await premier.fermer();}if(second){await second.fermer();}await rm(dir,{recursive:true,force:true});}
});
test('ne supprime rien si le démon ne répond pas ou si son identité a changé',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'protection-journal-test-'));let journal;
  try {
    journal=await ouvrirJournalProtege({repertoire:dir,identiteDemon:'a',nettoyer:async()=>true});
    await journal.recuperer();await journal.enregistrer(run);journal.abandonner(run);await journal.fermer();
    journal=await ouvrirJournalProtege({repertoire:dir,identiteDemon:'b',nettoyer:async()=>true});
    await assert.rejects(journal.recuperer(),/protected_recovery_unavailable/);await journal.fermer();
    journal=await ouvrirJournalProtege({repertoire:dir,identiteDemon:'a',nettoyer:async()=>false});
    await assert.rejects(journal.recuperer(),/protected_recovery_unavailable/);await journal.fermer();
    assert.ok((await readdir(dir)).includes(`run-${run}.json`));
    await writeFile(join(dir,'intrus'),'x');
    journal=await ouvrirJournalProtege({repertoire:dir,identiteDemon:'a',nettoyer:async()=>false});
    await assert.rejects(journal.recuperer(),/protected_recovery_unavailable/);
  } finally {if(journal){await journal.fermer();}await rm(dir,{recursive:true,force:true});}
});

test('après une mort brutale le journal est récupéré sous un nouveau verrou',async()=>{
  const { spawn }=require('node:child_process');
  const { once }=require('node:events');
  const dir=await mkdtemp(join(tmpdir(),'protection-journal-crash-'));let enfant,journal;
  try {
    const script=`const {ouvrirJournalProtege}=require('./src/protected-local-journal');\n`+
      `(async()=>{const j=await ouvrirJournalProtege({repertoire:process.argv[1],identiteDemon:'a',nettoyer:async()=>true});`+
      `await j.recuperer();await j.enregistrer(process.argv[2]);process.stdout.write('ready\\n');setInterval(()=>{},10000);})().catch(()=>process.exit(1));`;
    enfant=spawn(process.execPath,['-e',script,dir,run],{cwd:process.cwd(),stdio:['ignore','pipe','ignore']});
    const [message]=await once(enfant.stdout,'data');assert.equal(message.toString(),'ready\n');
    enfant.kill('SIGKILL');await once(enfant,'exit');
    const arrets=[];
    for(let i=0;i<30;i++){
      try {journal=await ouvrirJournalProtege({repertoire:dir,identiteDemon:'a',nettoyer:async id=>{arrets.push(id);return true;}});break;}
      catch {await new Promise(resolve=>setTimeout(resolve,20));}
    }
    assert.ok(journal);await journal.recuperer();assert.deepEqual(arrets,[run]);
  } finally {if(enfant){enfant.kill('SIGKILL');}if(journal){await journal.fermer();}await rm(dir,{recursive:true,force:true});}
});
