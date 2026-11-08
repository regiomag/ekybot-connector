'use strict';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const unavailable = () => { throw new Error('protected_runtime_unavailable'); };

/** Pont local expérimental : le fournisseur et ses identifiants sont choisis
 * par le compagnon, jamais par la boîte. Le protocole n'est pas encore relié à
 * un agent réel et ne doit pas être activé avant qualification du runtime. */
function creerPontLocalProtege({ appelerModele, limiteAppels, delaiMs = 60000, signal }) {
  if (typeof appelerModele !== 'function' || !Number.isInteger(limiteAppels) || limiteAppels < 1 || limiteAppels > 8
    || !Number.isInteger(delaiMs) || delaiMs < 100 || delaiMs > 120000
    || (signal !== undefined && !(signal instanceof AbortSignal))) {
    return unavailable();
  }
  const demandes = new Set();
  let occupe = false;
  return async function traiter(valeur) {
    if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)
      || Object.keys(valeur).sort().join(',') !== 'id,question,type' || valeur.type !== 'modele'
      || typeof valeur.id !== 'string' || !ID.test(valeur.id) || typeof valeur.question !== 'string'
      || !valeur.question.trim() || Buffer.byteLength(valeur.question, 'utf8') > 65536
      || demandes.has(valeur.id) || demandes.size >= limiteAppels || occupe || signal?.aborted) {
      return unavailable();
    }
    // En cas d'issue inconnue, ne jamais relancer la même requête : l'appel
    // distant pourrait déjà avoir été pris en compte ou facturé.
    demandes.add(valeur.id);
    occupe = true;
    const controle = new AbortController();
    let timer, annuler;
    try {
      const operation = Promise.resolve().then(() => {
        if (controle.signal.aborted) {return unavailable();}
        return appelerModele(valeur.question, controle.signal);
      });
      // Une annulation peut ne pas arrêter immédiatement le fournisseur ; le
      // pont reste occupé jusqu'à l'arrêt effectif de l'opération d'origine.
      operation.then(() => { occupe = false; }, () => { occupe = false; });
      const interruption = new Promise((_, reject) => {
        timer = setTimeout(() => { controle.abort(); reject(new Error()); }, delaiMs);
      });
      const annulation = new Promise((_, reject) => {
        annuler = () => { controle.abort(); reject(new Error()); };
        if (signal?.aborted) {annuler();}
        else {signal?.addEventListener('abort', annuler, { once: true });}
      });
      const texte = await Promise.race([operation, interruption, annulation]);
      if (typeof texte !== 'string' || !texte.trim() || texte.length > 10000 || Buffer.byteLength(texte, 'utf8') > 40000) {
        return unavailable();
      }
      return { type: 'modele_resultat', id: valeur.id, texte };
    } catch { return unavailable(); }
    finally { clearTimeout(timer); if (annuler) {signal?.removeEventListener('abort', annuler);} }
  };
}

module.exports = { creerPontLocalProtege };
