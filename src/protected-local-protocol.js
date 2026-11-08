'use strict';

const { once } = require('node:events');
const unavailable = () => { throw new Error('protected_runtime_unavailable'); };
const LIMIT_FRAME = 65536;
const LIMIT_TOTAL = 524288;

/** Canal local par stdin/stdout. Aucune URL, clé ou choix de fournisseur n'est
 * interprété ici. L'appelant doit encore qualifier et arrêter le conteneur. */
async function servirProtocoleProtege(lecture, ecriture, pont) {
  if (!lecture || typeof lecture[Symbol.asyncIterator] !== 'function' || !ecriture
    || typeof ecriture.write !== 'function' || typeof pont !== 'function') {return unavailable();}
  let tampon = Buffer.alloc(0), total = 0, frames = 0, reponse = null;
  try {
    for await (const morceau of lecture) {
      if (!Buffer.isBuffer(morceau) && !(morceau instanceof Uint8Array)) {return unavailable();}
      total += morceau.byteLength;
      if (morceau.byteLength > LIMIT_FRAME || total > LIMIT_TOTAL) {return unavailable();}
      tampon = Buffer.concat([tampon, morceau]);
      let fin;
      while ((fin = tampon.indexOf(10)) !== -1) {
        if (fin < 1 || fin > LIMIT_FRAME || ++frames > 20 || reponse !== null) {return unavailable();}
        const bytes = tampon.subarray(0, fin);
        tampon = tampon.subarray(fin + 1);
        const ligne = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const message = JSON.parse(ligne);
        if (message && typeof message === 'object' && !Array.isArray(message) && message.type === 'termine') {
          if (Object.keys(message).sort().join(',') !== 'texte,type' || typeof message.texte !== 'string'
            || !message.texte.trim() || message.texte.length > 10000 || Buffer.byteLength(message.texte, 'utf8') > 40000) {return unavailable();}
          reponse = message.texte;
          continue;
        }
        const resultat = await pont(message);
        const sortie = `${JSON.stringify(resultat)}\n`;
        if (Buffer.byteLength(sortie, 'utf8') > LIMIT_FRAME) {return unavailable();}
        if (!ecriture.write(sortie)) {await once(ecriture, 'drain');}
      }
      if (tampon.length > LIMIT_FRAME) {return unavailable();}
    }
    if (tampon.length || reponse === null) {return unavailable();}
    return reponse;
  } catch { return unavailable(); }
}

module.exports = { servirProtocoleProtege };
