'use strict';
const { executerAgentAvecApiProtegee }=require('./protected-configured-runner');
const unavailable=()=>{throw new Error('protected_machine_unavailable');};

/** Un travail à la fois, sans repli vers le relais historique. Les chemins,
 * le démon et le runtime proviennent exclusivement du poste. */
async function traiterTravailMachine({client,fichierConfiguration,socket,docker,repertoire,limiteAppels,delaiMs,signal}) {
  try {
    if(!client || typeof client.prendre!=='function' || typeof client.verifier!=='function'
      || typeof client.terminer!=='function' || !(signal instanceof AbortSignal)) {return unavailable();}
    signal.throwIfAborted();const travail=await client.prendre(signal);
    if(!travail){return {statut:'vide'};}
    const verifierDroits=async()=>{
      signal.throwIfAborted();
      if(await client.verifier(travail.bail,signal)!==true) {return unavailable();}
      signal.throwIfAborted();
    };
    await verifierDroits();
    const message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(travail.octets));
    const resultat=await executerAgentAvecApiProtegee({fichierConfiguration,selection:travail.selection,
      runtime:'api-compatible-local-v1',runId:message.metadata.runId,octets:travail.octets,liaison:travail.liaison,
      socket,docker,repertoire,verifierDroits,limiteAppels,delaiMs,signal});
    await verifierDroits();
    if(await client.terminer(travail.bail,resultat,signal)!==true) {return unavailable();}
    return {statut:'termine'};
  } catch {return unavailable();}
}
module.exports={traiterTravailMachine};
