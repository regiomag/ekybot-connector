'use strict';
const { creerClientMachineProtegee }=require('./protected-machine-client');
const { traiterTravailMachine }=require('./protected-machine-worker');
const { recupererRuntimeInterrompu }=require('./protected-runtime-recovery');

/** Préparation d'un cycle dans la boucle existante. Le fichier, le démon et
 * les limites sont locaux ; le message distant ne peut pas les configurer. */
async function cycleMachineProtegee({etat,reglages,signal}) {
  try {
    if(!etat || typeof etat.baseUrl!=='string' || typeof etat.machineApiKey!=='string'
      || !reglages || typeof reglages!=='object' || !(signal instanceof AbortSignal)) {throw new Error();}
    await recupererRuntimeInterrompu(reglages);
    if(signal.aborted) {throw new Error();}
    const client=creerClientMachineProtegee({origine:etat.baseUrl.replace(/\/$/,''),obtenirCleMachine:async()=>etat.machineApiKey});
    return await traiterTravailMachine({client,fichierConfiguration:reglages.fichierConfiguration,
      socket:reglages.socket,docker:reglages.docker,repertoire:reglages.repertoire,
      limiteAppels:reglages.limiteAppels,delaiMs:reglages.delaiMs,signal});
  } catch {throw new Error('protected_machine_unavailable');}
}
module.exports={cycleMachineProtegee};
