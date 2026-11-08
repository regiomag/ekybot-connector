'use strict';

// Banc de construction ARM64 : aucune image n'est inscrite au registre de
// production. Le binaire Buildx et la base doivent déjà être disponibles.
const fs=require('node:fs/promises');
const { createReadStream,constants }=require('node:fs');
const { createHash }=require('node:crypto');
const { spawn }=require('node:child_process');
const { tmpdir }=require('node:os');
const { join,isAbsolute }=require('node:path');
const { preparerContexteRuntime }=require('../src/protected-runtime-build');
const BASE='sha256:b0d33ed19a912e1a18ceb83e139815233cd49c123fe025e67a7c506c93e3f728';
const CONFIGURATION='sha256:3643c9a8e7f507590fe95f2458c976442cf1457d49541becd60c8782476a3d5d';
const ARCHIVE='8a2c5194004447c29b60ef83a1b8185cb3c14e36a449754ceda5ba218b847f7a';

async function empreinte(fichier) {
  const hash=createHash('sha256');
  for await(const morceau of createReadStream(fichier)) {hash.update(morceau);}
  return hash.digest('hex');
}
function commande(docker,args,config) {
  return new Promise((resolve,reject)=>{
    const enfant=spawn(docker,args,{env:{PATH:'/usr/bin:/bin',DOCKER_CONFIG:config},stdio:['ignore','pipe','ignore'],shell:false});
    let sortie='',tropLong=false;
    const limite=setTimeout(()=>{tropLong=true;enfant.kill('SIGKILL');},120000);
    enfant.stdout.on('data',morceau=>{sortie+=morceau.toString();if(sortie.length>4096){tropLong=true;enfant.kill();}});
    enfant.on('error',erreur=>{clearTimeout(limite);reject(erreur);});
    enfant.on('close',code=>{clearTimeout(limite);code===0 && !tropLong?resolve(sortie.trim()):reject(new Error('runtime_build_unavailable'));});
  });
}
async function construire(docker,socket,buildx,destination) {
  if(!['/usr/bin/docker','/usr/local/bin/docker','/opt/homebrew/bin/docker'].includes(docker)
    || ![socket,buildx,destination].every(v=>typeof v==='string' && isAbsolute(v))) {throw new Error('runtime_build_unavailable');}
  let temporaire,contexte,etape='preparation';
  try {
    try {await fs.lstat(destination);throw new Error('destination_exists');}
    catch(erreur) {if(erreur.code!=='ENOENT') {throw erreur;}}
    const socketReel=await fs.realpath(socket);
    if(!(await fs.stat(socketReel)).isSocket() || !(await fs.stat(buildx)).isFile()) {throw new Error();}
    temporaire=await fs.mkdtemp(join(tmpdir(),'bmt-runtime-build-'));
    const config=join(temporaire,'docker');await fs.mkdir(join(config,'cli-plugins'),{recursive:true,mode:0o700});
    const plugin=join(config,'cli-plugins','docker-buildx');
    await fs.copyFile(buildx,plugin,constants.COPYFILE_EXCL);await fs.chmod(plugin,0o700);
    const commun=['--config',config,'--host',`unix://${socketReel}`];
    const arch=await commande(docker,[...commun,'info','--format','{{.Architecture}}'],config);
    if(!['aarch64','arm64'].includes(arch)) {throw new Error();}
    const base=await commande(docker,[...commun,'image','inspect',`node@${BASE}`,'--format','{{.Id}}'],config);
    if(base!==BASE) {throw new Error();}
    etape='contexte';
    contexte=await preparerContexteRuntime(BASE);
    const archive=join(temporaire,'image.tar'),iid=join(temporaire,'image.id');
    etape='construction';
    await commande(docker,[...commun,'buildx','build','--no-cache','--network=none','--pull=false',
      '--provenance=false','--build-arg','SOURCE_DATE_EPOCH=0','--iidfile',iid,'--output',
      `type=oci,dest=${archive},rewrite-timestamp=true`,contexte.chemin],config);
    etape='configuration';
    if((await fs.readFile(iid,'utf8')).trim()!==CONFIGURATION) {throw new Error();}
    etape='archive';
    if(await empreinte(archive)!==ARCHIVE) {throw new Error();}
    // Pas d'écrasement d'un fichier existant, même en cas de relance.
    etape='destination';await fs.copyFile(archive,destination,constants.COPYFILE_EXCL);await fs.chmod(destination,0o600);
  } catch {throw new Error(`runtime_build_unavailable:${etape}`);}
  finally {
    if(contexte) {await fs.rm(contexte.chemin,{recursive:true,force:true}).catch(()=>{});}
    if(temporaire) {await fs.rm(temporaire,{recursive:true,force:true}).catch(()=>{});}
  }
}
if(require.main===module) {
  construire(...process.argv.slice(2)).then(()=>process.stdout.write('Archive ARM64 construite et empreintes vérifiées.\n'),()=>{
    process.stderr.write('Construction vérifiée indisponible.\n');process.exitCode=1;
  });
}
module.exports={construire};
