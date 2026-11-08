'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { isAbsolute } = require('node:path');
const { analyserEndpoint } = require('./protected-model-transport');
const unavailable = () => {throw new Error('protected_model_unavailable');};
const exact = (x,keys) => !!x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).sort().join(',') === [...keys].sort().join(',');

/** Le fichier est local et privé ; il contient le nom d'une variable, jamais
 * sa valeur. L'agent et son modèle viennent d'une sélection authentifiée. */
async function chargerModeleProtege(fichier, selection, environnement = process.env) {
  try {
    if (typeof fichier !== 'string' || !isAbsolute(fichier)
      || !exact(selection,['agent','provider','modele']) || typeof selection.agent !== 'string'
      || !selection.agent || selection.agent.length > 200 || selection.provider !== 'api-compatible-explicite'
      || typeof selection.modele !== 'string' || !selection.modele || selection.modele.length > 128
      || !environnement || typeof environnement !== 'object') {return unavailable();}
    const info = await fs.lstat(fichier);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 32768 || (info.mode & 0o077) !== 0
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {return unavailable();}
    const fd = await fs.open(fichier, constants.O_RDONLY | constants.O_NOFOLLOW);
    let data;
    try {
      const courant = await fd.stat();
      if (!courant.isFile() || courant.ino !== info.ino || courant.dev !== info.dev
        || courant.size < 1 || courant.size > 32768 || (courant.mode & 0o077) !== 0
        || (typeof process.getuid === 'function' && courant.uid !== process.getuid())) {return unavailable();}
      const tampon = Buffer.alloc(32769);let position = 0;
      for (;;) {
        const { bytesRead } = await fd.read(tampon,position,tampon.length-position,position);
        if (!bytesRead) {break;}
        position += bytesRead;if (position > 32768) {return unavailable();}
      }
      data = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(tampon.subarray(0,position)));
    } finally {await fd.close();}
    if (!exact(data,['version','agents']) || data.version !== 1 || !Array.isArray(data.agents)
      || data.agents.length > 50) {return unavailable();}
    const vus = new Set();
    for (const agent of data.agents) {
      if (!exact(agent,['agent','provider','modele','endpoint','limite','parametreLimite','variableCle'])
        || typeof agent.agent !== 'string' || !agent.agent || agent.agent.length > 200 || vus.has(agent.agent)
        || agent.provider !== 'api-compatible-explicite' || typeof agent.modele !== 'string' || !agent.modele
        || (agent.variableCle === null ? !analyserEndpoint(agent.endpoint).local
          : typeof agent.variableCle !== 'string' || !/^[A-Z][A-Z0-9_]{2,63}$/.test(agent.variableCle))) {return unavailable();}
      vus.add(agent.agent);
    }
    const agent = data.agents.find(v => v.agent === selection.agent);
    if (!agent || agent.provider !== selection.provider || agent.modele !== selection.modele) {return unavailable();}
    const variable = agent.variableCle;
    const configuration = Object.freeze({mode:'api-compatible-explicite',modele:agent.modele,endpoint:agent.endpoint,
      limite:agent.limite,parametreLimite:agent.parametreLimite});
    return {configuration,obtenirCle:async()=>{
      if (variable === null) {return null;}
      const cle = environnement[variable];
      if (typeof cle !== 'string' || !cle || cle.length > 4096 || /[\r\n]/.test(cle)) {return unavailable();}
      return cle;
    }};
  } catch {return unavailable();}
}
module.exports = { chargerModeleProtege };
