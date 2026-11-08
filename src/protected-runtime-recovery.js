'use strict';
const { ouvrirDockerProtege } = require('./protected-local-docker');
const { ouvrirJournalProtege } = require('./protected-local-journal');

/** La reprise précède toute demande distante, même si aucune tâche n'attend. */
async function recupererRuntimeInterrompu({docker,socket,repertoire}, ports = {}) {
  let demon, journal, erreur = false;
  try {
    demon = await (ports.ouvrirDocker || ouvrirDockerProtege)(docker,socket);
    journal = await (ports.ouvrirJournal || ouvrirJournalProtege)({
      repertoire,identiteDemon:demon.identite,nettoyer:demon.nettoyer,
    });
    await journal.recuperer();
  } catch {erreur = true;}
  finally {
    if (journal) {try {await journal.fermer();} catch {erreur = true;}}
    if (demon) {try {await demon.fermer();} catch {erreur = true;}}
  }
  if (erreur) {throw new Error('protected_recovery_unavailable');}
}
module.exports = { recupererRuntimeInterrompu };
