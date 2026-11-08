'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { isAbsolute,join } = require('node:path');
const { createHash } = require('node:crypto');
const { verrouillerSuperviseur } = require('./protected-local-lock');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REC = /^run-([0-9a-f-]{36})\.json$/;
const unavailable = () => {throw new Error('protected_recovery_unavailable');};
async function syncDirectory(dir) {
  const fd = await fs.open(dir, 'r');
  try {await fd.sync();} finally {await fd.close();}
}
async function ouvrirJournalProtege({ repertoire,identiteDemon,nettoyer }) {
  if (typeof repertoire !== 'string' || !isAbsolute(repertoire) || typeof identiteDemon !== 'string'
    || identiteDemon.length < 1 || identiteDemon.length > 512 || typeof nettoyer !== 'function') {return unavailable();}
  await fs.mkdir(repertoire, { mode:0o700,recursive:true });
  const stat = await fs.lstat(repertoire);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {return unavailable();}
  const verrou = await verrouillerSuperviseur(repertoire);
  const empreinte = createHash('sha256').update(identiteDemon).digest('hex');
  let pret = false,actif = null,ferme = false,occupe = false;
  const controle = () => {if (ferme || verrou.signal.aborted) {return unavailable();}};
  const fichier = id => join(repertoire, `run-${id}.json`);
  const supprimer = async id => {controle();await fs.unlink(fichier(id));await syncDirectory(repertoire);controle();};
  const verifier = async (nom) => {
    const match = REC.exec(nom);if (!match || !ID.test(match[1])) {return unavailable();}
    const chemin = join(repertoire, nom), info = await fs.lstat(chemin);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 512 || (info.mode & 0o077) !== 0
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {return unavailable();}
    const fd = await fs.open(chemin, constants.O_RDONLY | constants.O_NOFOLLOW);
    let donnees;
    try {donnees = JSON.parse(await fd.readFile('utf8'));} finally {await fd.close();}
    if (!donnees || Object.keys(donnees).sort().join(',') !== 'demon,run,version' || donnees.version !== 1
      || donnees.run !== match[1] || donnees.demon !== empreinte) {return unavailable();}
    return match[1];
  };
  return {
    signal:verrou.signal,
    async recuperer() {
      controle();if (actif || pret || occupe) {return unavailable();}
      occupe = true;
      try {
      const noms = await fs.readdir(repertoire);
      for (const nom of noms) {
        if (nom === 'supervisor.lock') {continue;}
        const id = await verifier(nom);controle();
        if (await nettoyer(id) !== true) {return unavailable();}
        await supprimer(id);
      }
      controle();pret = true;
      } finally {occupe = false;}
    },
    async enregistrer(id) {
      controle();if (!pret || actif || occupe || typeof id !== 'string' || !ID.test(id)) {return unavailable();}
      actif = id;occupe = true;
      try {
        const fd = await fs.open(fichier(id), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try {await fd.writeFile(JSON.stringify({version:1,run:id,demon:empreinte}));await fd.sync();} finally {await fd.close();}
        await syncDirectory(repertoire);controle();
      } catch {pret = false;throw new Error('protected_recovery_unavailable');} finally {occupe = false;}
    },
    async terminer(id) {
      controle();if (!pret || actif !== id || occupe) {return unavailable();}
      occupe = true;
      try {
        // L'absence effective est vérifiée, pas simplement affirmée par l'appelant.
        if (await nettoyer(id) !== true) {pret = false;return unavailable();}
        await supprimer(id);actif = null;
      } finally {occupe = false;}
    },
    abandonner(id) {
      controle();if (actif !== id || occupe) {return unavailable();}
      // Un travail dont l'arrêt est incertain reste inscrit pour le prochain démarrage.
      actif = null;pret = false;
    },
    async fermer() {
      if (ferme) {return;}
      if (actif || occupe) {return unavailable();}
      ferme = true;await verrou.fermer();
    },
  };
}
module.exports = { ouvrirJournalProtege };
