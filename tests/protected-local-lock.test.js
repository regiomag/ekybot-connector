'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp,rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { verrouillerSuperviseur } = require('../src/protected-local-lock');
test('un seul superviseur détient le verrou et peut le relâcher',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'protection-lock-test-'));let premier;
  try {
    premier=await verrouillerSuperviseur(dir);
    await assert.rejects(verrouillerSuperviseur(dir),/protected_lock_unavailable/);
    await premier.fermer();assert.equal(premier.signal.aborted,true);
    const second=await verrouillerSuperviseur(dir);await second.fermer();
  } finally {if(premier){await premier.fermer();}await rm(dir,{recursive:true,force:true});}
});
