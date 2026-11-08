'use strict';
const { execFile } = require('node:child_process');
const { mkdtemp,realpath,rm,stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join,isAbsolute } = require('node:path');
const BINAIRES = new Set(['/usr/bin/docker','/usr/local/bin/docker','/opt/homebrew/bin/docker']);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const unavailable = () => {throw new Error('protected_recovery_unavailable');};

/** Arrête uniquement le conteneur associé au travail, sur le même démon.
 * Toute sortie ambiguë, changement d'identité ou perte du démon bloque. */
async function nettoyerConteneurProtege(id,identite,port) {
  if (!ID.test(id) || typeof identite !== 'string' || !identite || !port) {return unavailable();}
  const verifier = async () => {if (await port.identite() !== identite) {return unavailable();}};
  const nom = `bmt-protected-${id}`;
  await verifier();
  const avant = await port.lister(nom);
  await verifier();
  if (avant === '') {return true;}
  if (avant !== nom) {return unavailable();}
  try {await port.arreter(nom);} catch { /* Le conteneur peut avoir terminé simultanément. */ }
  await verifier();
  const apres = await port.lister(nom);
  await verifier();
  if (apres !== '') {return unavailable();}
  return true;
}

/** Config Docker vierge et chemin de socket déterminé localement, jamais par
 * le message ou par le conteneur. Aucun stdout/stderr de Docker n'est journalisé. */
async function ouvrirDockerProtege(docker,socket) {
  if (!BINAIRES.has(docker) || typeof socket !== 'string' || !isAbsolute(socket)) {return unavailable();}
  const reel = await realpath(socket);
  if (!(await stat(reel)).isSocket()) {return unavailable();}
  const config = await mkdtemp(join(tmpdir(),'bmt-protected-supervisor-'));
  const appel = args => new Promise((resolve,reject) => {
    execFile(docker,['--config',config,'--host',`unix://${reel}`,...args],
      {cwd:config,env:{PATH:'/usr/bin:/bin',HOME:config},timeout:5000,maxBuffer:65536},
      (erreur,stdout) => erreur ? reject(new Error('protected_recovery_unavailable')) : resolve(stdout));
  });
  const port = {
    identite:async()=>{
      const id = (await appel(['info','--format','{{.ID}}'])).trim();
      if (!/^[A-Za-z0-9:._-]{1,128}$/.test(id)) {return unavailable();}
      return `${reel}\n${id}`;
    },
    lister:async nom => (await appel(['ps','--filter',`name=^/${nom}$`,'--format','{{.Names}}'])).trim(),
    arreter:async nom => {await appel(['kill',nom]);},
  };
  try {
    const identite = await port.identite();
    return { identite,nettoyer:id=>nettoyerConteneurProtege(id,identite,port),
      fermer:async()=>{await rm(config,{recursive:true,force:true});} };
  } catch {await rm(config,{recursive:true,force:true}).catch(()=>{});return unavailable();}
}
module.exports = { ouvrirDockerProtege,nettoyerConteneurProtege };
