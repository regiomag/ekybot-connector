'use strict';
const { creerTransportModeleProtege } = require('./protected-model-transport');
const { executerAgentLocalProtege } = require('./protected-local-executor');
const { planProtectedLocalRuntime } = require('./protected-local-sandbox');
const { verifierMessageLocalProtege } = require('./protected-local-contract');
const { ouvrirDockerProtege } = require('./protected-local-docker');
const { ouvrirJournalProtege } = require('./protected-local-journal');
const unavailable = () => {throw new Error('protected_runtime_unavailable');};

/** Programme interne : chaque paramètre provient de la configuration privée
 * du poste et de la liaison authentifiée, jamais du message de l'agent.
 * Cette voie API explicite ne convertit pas une session CLI en clé payante. */
async function executerAgentAvecApiProtegee({ configuration, obtenirCle, runtime, runId, octets, liaison, socket, docker,
  repertoire,verifierDroits,limiteAppels,delaiMs,signal }) {
  let demon,journal,inscrit = false,execute = false,resultat,erreur = false,incertain = false;
  let annuler,perteVerrou;
  const controle = new AbortController();
  try {
    // Refuser toute opération avant la qualification du runtime et du message.
    planProtectedLocalRuntime(runtime,runId);
    const message = verifierMessageLocalProtege(octets,liaison);
    if (message.metadata.runId !== runId || typeof verifierDroits !== 'function' || !(signal instanceof AbortSignal)
      || signal.aborted) {return unavailable();}
    const appelerModele = creerTransportModeleProtege({ configuration,obtenirCle });
    await verifierDroits();
    demon = await ouvrirDockerProtege(docker,socket);
    journal = await ouvrirJournalProtege({repertoire,identiteDemon:demon.identite,nettoyer:demon.nettoyer});
    annuler = () => controle.abort();perteVerrou = () => controle.abort();
    signal.addEventListener('abort',annuler,{once:true});
    journal.signal.addEventListener('abort',perteVerrou,{once:true});
    if (signal.aborted || journal.signal.aborted) {controle.abort();return unavailable();}
    await journal.recuperer();
    await verifierDroits();
    if (controle.signal.aborted) {return unavailable();}
    // L'inscription est durable avant le premier spawn Docker.
    inscrit = true;await journal.enregistrer(runId);
    await verifierDroits();
    if (controle.signal.aborted) {return unavailable();}
    execute = true;
    resultat = await executerAgentLocalProtege({ runtime,runId,octets,liaison,socket,docker,
      verifierDroits,limiteAppels,delaiMs,signal:controle.signal,appelerModele });
    if (controle.signal.aborted) {return unavailable();}
    await verifierDroits();
  } catch {erreur = true;}
  finally {
    controle.abort();
    if (annuler) {signal.removeEventListener('abort',annuler);}
    if (perteVerrou) {journal.signal.removeEventListener('abort',perteVerrou);}
    if (inscrit) {
      try {await journal.terminer(runId);} catch {
        // La preuve d'arrêt manque : le repère durable reste pour la reprise.
        incertain = true;
        try {journal.abandonner(runId);} catch { /* Perte de verrou : la reprise prendra le relais. */ }
      }
    }
    if (journal) {try {await journal.fermer();} catch {incertain = true;}}
    if (demon) {await demon.fermer().catch(() => {incertain = true;});}
  }
  if (incertain || signal?.aborted) {return unavailable();}
  if (erreur || !resultat) {
    // L'échec confirmé implique qu'aucun conteneur ne reste en cours ; il ne
    // préjuge pas d'un éventuel appel modèle déjà facturé et ne sera pas rejoué.
    return {statut:'echec_confirme'};
  }
  if (!execute || typeof resultat.texte !== 'string') {return unavailable();}
  return {statut:'termine',texte:resultat.texte};
}
module.exports = { executerAgentAvecApiProtegee };
