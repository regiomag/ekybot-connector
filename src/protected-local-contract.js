'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LANGUES = new Set(['fr', 'de', 'it', 'en']);
const DEVISES = new Set(['CHF', 'EUR', 'USD', 'GBP']);
const STATUTS = new Set(['open', 'in_review', 'closed', 'locked']);
const obj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => obj(x) && Object.keys(x).sort().join(',') === [...keys].sort().join(',');
const opaque = (x) => typeof x === 'string' && UUID.test(x);
const date = (x) => {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) {return false;}
  const valeur = new Date(`${x}T00:00:00.000Z`);
  return Number.isFinite(valeur.valueOf()) && valeur.toISOString().slice(0, 10) === x;
};
const unavailable = () => { throw new Error('protected_runtime_unavailable'); };

/** Dernière frontière du compagnon : aucune phrase libre, pièce, nom ou champ
 * nouveau ne peut entrer dans la boîte. La liaison vient du serveur Ekybot. */
function verifierMessageLocalProtege(octets, liaison) {
  try {
    if (!(octets instanceof Uint8Array) || octets.byteLength < 1 || octets.byteLength > 65536
      || !liaison || !opaque(liaison.projet) || typeof liaison.agent !== 'string') {return unavailable();}
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(octets));
    if (!exact(value, ['contrat', 'requestId', 'messageId', 'channelId', 'agentId', 'intention', 'langue', 'donnees', 'metadata'])
      || value.contrat !== 1 || !['contexte', 'exercices'].includes(value.intention) || !LANGUES.has(value.langue)
      || value.agentId !== liaison.agent || !/^agent:[0-9a-f-]{36}$/.test(value.agentId)
      || !opaque(value.agentId.slice(6)) || !exact(value.metadata, ['projectId', 'runId'])
      || value.metadata.projectId !== liaison.projet) {return unavailable();}
    const refs = [value.requestId, value.messageId, value.channelId, value.metadata.projectId, value.metadata.runId, value.agentId.slice(6)];
    if (!refs.every(opaque) || new Set(refs).size !== refs.length) {return unavailable();}
    const data = value.donnees, exercices = value.intention === 'exercices';
    if (!exact(data, exercices ? ['contrat', 'retrouver_dans_bmt', 'capacites', 'dossier', 'exercices']
      : ['contrat', 'retrouver_dans_bmt', 'capacites', 'dossier']) || data.contrat !== 1
      || data.retrouver_dans_bmt !== 'https://www.bemytalent.com/app/agent-reference'
      || !exact(data.capacites, ['lectures', 'demandes_libres_bmt', 'pieces', 'ecritures', 'paie'])
      || data.capacites.demandes_libres_bmt !== false || data.capacites.pieces !== false
      || data.capacites.ecritures !== false || data.capacites.paie !== false
      || !Array.isArray(data.capacites.lectures) || data.capacites.lectures.length < 1 || data.capacites.lectures.length > 2
      || new Set(data.capacites.lectures).size !== data.capacites.lectures.length
      || !data.capacites.lectures.every((x) => ['contexte_v1', 'exercices_v1'].includes(x))
      || !data.capacites.lectures.includes(exercices ? 'exercices_v1' : 'contexte_v1')
      || !exact(data.dossier, ['reference', 'devise']) || !opaque(data.dossier.reference)
      || !DEVISES.has(data.dossier.devise) || refs.includes(data.dossier.reference)) {return unavailable();}
    refs.push(data.dossier.reference);
    if (exercices) {
      if (!Array.isArray(data.exercices) || data.exercices.length > 500) {return unavailable();}
      for (const e of data.exercices) {
        if (!exact(e, ['reference', 'debut', 'fin', 'statut']) || !opaque(e.reference) || refs.includes(e.reference)
          || !date(e.debut) || !date(e.fin) || e.debut > e.fin || !STATUTS.has(e.statut)) {return unavailable();}
        refs.push(e.reference);
      }
    }
    return value;
  } catch { return unavailable(); }
}
module.exports = { verifierMessageLocalProtege };
