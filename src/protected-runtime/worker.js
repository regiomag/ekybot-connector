'use strict';

// Programme de l'image locale : données structurées et éphémères uniquement.
// Le poste contrôle le fournisseur, ses secrets et le budget via le pont.
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { verifierMessageLocalProtege } = require('../protected-local-contract');
const MAX_FRAME = 65536;
const MAX_TOTAL = 160000;
const fail = () => { throw new Error('protected_runtime_unavailable'); };
const exact = (x, keys) => !!x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).sort().join(',') === keys.sort().join(',');

function creerQuestion(message) {
  const instructions = {
    fr:'Réponds en français. Explique uniquement les données fournies. Ne devine pas les noms ou informations manquantes. Conserve les références telles quelles. Signale les limites et ne propose aucune action d’écriture.',
    de:'Antworte auf Deutsch. Erkläre nur die angegebenen Daten. Errate keine Namen oder fehlenden Angaben. Behalte Referenzen unverändert. Nenne Grenzen und schlage keine Schreibaktion vor.',
    en:'Respond in English. Explain only the supplied data. Do not guess names or missing information. Keep references unchanged. State limitations and do not propose write actions.',
    it:'Rispondi in italiano. Spiega solo i dati forniti. Non indovinare nomi o informazioni mancanti. Mantieni invariati i riferimenti. Indica i limiti e non proporre azioni di scrittura.',
  };
  const choix = {
    fr:{contexte:'Explique le contexte de ce dossier.',exercices:'Explique les exercices comptables disponibles.'},
    de:{contexte:'Erkläre den Kontext dieses Dossiers.',exercices:'Erkläre die verfügbaren Geschäftsjahre.'},
    en:{contexte:'Explain this project context.',exercices:'Explain the available financial years.'},
    it:{contexte:'Spiega il contesto del dossier.',exercices:'Spiega gli esercizi contabili disponibili.'},
  };
  if (!instructions[message.langue] || !choix[message.langue][message.intention]) {return fail();}
  const question = `${instructions[message.langue]}\n${choix[message.langue][message.intention]}\n${JSON.stringify(message.donnees)}`;
  if (Buffer.byteLength(question, 'utf8') > MAX_FRAME) {return fail();}
  return question;
}

/** Lit strictement deux messages : demande puis réponse du modèle. */
async function travailler(entree, sortie) {
  if (!entree || typeof entree[Symbol.asyncIterator] !== 'function' || !sortie || typeof sortie.write !== 'function') {return fail();}
  let tampon = Buffer.alloc(0), total = 0, etape = 0, id;
  for await (const bloc of entree) {
    if (!(bloc instanceof Uint8Array) || (total += bloc.byteLength) > MAX_TOTAL) {return fail();}
    tampon = Buffer.concat([tampon, bloc]);
    let fin;
    while ((fin = tampon.indexOf(10)) !== -1) {
      if (fin < 1 || fin > MAX_FRAME || etape > 1) {return fail();}
      const ligne = new TextDecoder('utf-8', { fatal: true }).decode(tampon.subarray(0, fin));
      tampon = tampon.subarray(fin + 1);
      const valeur = JSON.parse(ligne);
      let reponse;
      if (etape === 0) {
        if (!exact(valeur, ['type', 'message']) || valeur.type !== 'demarrer'
          || !valeur.message || typeof valeur.message !== 'object' || !valeur.message.metadata) {return fail();}
        const message = verifierMessageLocalProtege(Buffer.from(JSON.stringify(valeur.message)),
          { projet:valeur.message.metadata.projectId,agent:valeur.message.agentId });
        id = randomUUID();
        reponse = { type:'modele',id,question:creerQuestion(message) };
      } else {
        if (!exact(valeur, ['type', 'id', 'texte']) || valeur.type !== 'modele_resultat' || valeur.id !== id
          || typeof valeur.texte !== 'string' || !valeur.texte.trim() || valeur.texte.length > 10000
          || Buffer.byteLength(valeur.texte, 'utf8') > 40000) {return fail();}
        reponse = { type:'termine',texte:valeur.texte };
      }
      const sortieLigne = `${JSON.stringify(reponse)}\n`;
      if (Buffer.byteLength(sortieLigne, 'utf8') > MAX_FRAME) {return fail();}
      if (!sortie.write(sortieLigne)) {await once(sortie, 'drain');}
      etape++;
      if (etape === 2) {
        if (tampon.length) {return fail();}
        return;
      }
    }
    if (tampon.length > MAX_FRAME) {return fail();}
  }
  return fail();
}

if (require.main === module) {
  travailler(process.stdin, process.stdout).then(() => {process.stdin.destroy();process.exitCode = 0;},
    () => {process.stdin.destroy();process.exitCode = 1;});
}
module.exports = { creerQuestion,travailler };
