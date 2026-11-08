'use strict';
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const IMAGE=/^sha256:[0-9a-f]{64}$/;
const empreinte = octets => createHash('sha256').update(octets).digest('hex');

/** Contexte minimal à examiner avant une construction locale. Ne lance pas
 * Docker, ne télécharge rien et ne qualifie aucune image automatiquement. */
async function preparerContexteRuntime(baseImage) {
  if (typeof baseImage !== 'string' || !IMAGE.test(baseImage)) {throw new Error('protected_runtime_unavailable');}
  let chemin;
  try {
    const travailleur=await fs.readFile(join(__dirname,'protected-runtime','worker.js'));
    const contrat=await fs.readFile(join(__dirname,'protected-local-contract.js'));
    if (!travailleur.length || travailleur.length>65536 || !contrat.length || contrat.length>65536) {throw new Error();}
    const dockerfile=Buffer.from(`FROM node@${baseImage}\nCOPY --chown=65534:65534 protected-local-contract.js /app/src/protected-local-contract.js\n`+
      'COPY --chown=65534:65534 worker.js /app/src/protected-runtime/worker.js\nWORKDIR /app\nUSER 65534:65534\n'+
      'ENV NODE_OPTIONS= NODE_PATH= HOME=/tmp\nHEALTHCHECK NONE\n'+
      'ENTRYPOINT ["/usr/local/bin/node", "/app/src/protected-runtime/worker.js"]\nCMD ["--"]\n');
    chemin=await fs.mkdtemp(join(tmpdir(),'bmt-runtime-context-'));
    await fs.writeFile(join(chemin,'Dockerfile'),dockerfile,{mode:0o600,flag:'wx'});
    await fs.writeFile(join(chemin,'worker.js'),travailleur,{mode:0o600,flag:'wx'});
    await fs.writeFile(join(chemin,'protected-local-contract.js'),contrat,{mode:0o600,flag:'wx'});
    // Les fichiers du contexte ne doivent pas changer l'image selon l'heure
    // à laquelle le poste a préparé sa construction.
    await Promise.all(['Dockerfile','worker.js','protected-local-contract.js'].map(nom=>fs.utimes(join(chemin,nom),0,0)));
    return {chemin,manifest:{version:1,baseImage,dockerfile:empreinte(dockerfile),
      travailleur:empreinte(travailleur),contrat:empreinte(contrat)}};
  } catch {if(chemin){await fs.rm(chemin,{recursive:true,force:true}).catch(()=>{});}throw new Error('protected_runtime_unavailable');}
}
module.exports = { preparerContexteRuntime };
