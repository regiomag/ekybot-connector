'use strict';
const { verifierMessageLocalProtege } = require('./protected-local-contract');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MACHINE=/^ekm_[a-f0-9]{48}$/;
const ID=/^[A-Za-z0-9_-]{1,200}$/;
const CHEMIN='/api/companion/protected/tasks';
const exact=(v,cles)=>!!v && typeof v==='object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',')===[...cles].sort().join(',');
const unavailable=()=>{throw new Error('protected_machine_unavailable');};
function attendre(operation,signal) {
  return new Promise((resolve,reject)=>{
    const annuler=()=>{signal.removeEventListener('abort',annuler);reject(new Error());};
    if(signal.aborted){annuler();return;}
    signal.addEventListener('abort',annuler,{once:true});
    Promise.resolve(operation).then(valeur=>{signal.removeEventListener('abort',annuler);resolve(valeur);},
      erreur=>{signal.removeEventListener('abort',annuler);reject(erreur);});
  });
}

/** Destination et authentification viennent du poste. Les informations de
 * liaison et la clé machine ne sont jamais transmises au conteneur. */
function creerClientMachineProtegee({origine,obtenirCleMachine,envoyer=fetch}) {
  if(typeof origine!=='string' || typeof obtenirCleMachine!=='function' || typeof envoyer!=='function') {return unavailable();}
  let url;
  try {url=new URL(origine);} catch {return unavailable();}
  if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash
    || url.origin!==origine) {return unavailable();}
  async function appeler(body,signal) {
    const limite=new AbortController();let timer,annuler;
    try {
      if(!(signal instanceof AbortSignal) || signal.aborted) {return unavailable();}
      annuler=()=>limite.abort();signal.addEventListener('abort',annuler,{once:true});
      timer=setTimeout(()=>limite.abort(),8000);if(signal.aborted){limite.abort();}
      const cle=await attendre(obtenirCleMachine(),limite.signal);
      if(typeof cle!=='string' || !MACHINE.test(cle) || limite.signal.aborted) {return unavailable();}
      const req=await attendre(envoyer(url.origin+CHEMIN,{method:'POST',redirect:'error',signal:limite.signal,
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${cle}`},body:JSON.stringify(body)}),limite.signal);
      if(!req || req.status!==200 || req.redirected
        || req.headers?.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'
        || !req.body || typeof req.body.getReader!=='function') {return unavailable();}
      const length=req.headers.get('content-length');
      if(length!==null && (!/^\d+$/.test(length) || Number(length)>70000)) {return unavailable();}
      const lecteur=req.body.getReader(),morceaux=[];let total=0;
      try {
        for(;;){
          limite.signal.throwIfAborted();const {done,value}=await attendre(lecteur.read(),limite.signal);if(done){break;}
          if(!(value instanceof Uint8Array) || (total+=value.byteLength)>70000) {return unavailable();}
          morceaux.push(value);
        }
      } finally {void lecteur.cancel().catch(()=>{});try {lecteur.releaseLock();} catch { /* Lecture annulée. */ }}
      limite.signal.throwIfAborted();
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(morceaux)));
    } catch {return unavailable();}
    finally {clearTimeout(timer);if(annuler){signal.removeEventListener('abort',annuler);}}
  }
  function verifierBail(travail) {
    if(!exact(travail,['connexion','demande','bail']) || !UUID.test(travail.connexion)
      || !UUID.test(travail.demande) || !UUID.test(travail.bail)
      || new Set([travail.connexion,travail.demande,travail.bail]).size!==3) {return unavailable();}
  }
  return {
    async prendre(signal) {
      const valeur=await appeler({action:'prendre',version:1},signal);
      if(exact(valeur,['statut']) && valeur.statut==='vide') {return null;}
      if(!exact(valeur,['statut','connexion','demande','bail','selection','liaison','message']) || valeur.statut!=='travail'
        || !exact(valeur.selection,['agent','provider','modele']) || !ID.test(valeur.selection.agent)
        || valeur.selection.provider!=='api-compatible-explicite' || typeof valeur.selection.modele!=='string'
        || !valeur.selection.modele.trim() || valeur.selection.modele.length>128
        || !exact(valeur.liaison,['projet','agent']) || !UUID.test(valeur.liaison.projet)
        || typeof valeur.liaison.agent!=='string' || !/^agent:[0-9a-f-]{36}$/.test(valeur.liaison.agent)) {return unavailable();}
      const bail={connexion:valeur.connexion,demande:valeur.demande,bail:valeur.bail};verifierBail(bail);
      const octets=Buffer.from(JSON.stringify(valeur.message));
      let message;try {message=verifierMessageLocalProtege(octets,valeur.liaison);} catch {return unavailable();}
      if(message.requestId!==bail.demande) {return unavailable();}
      // Valeurs recopiées : un objet fourni par le serveur ne peut changer
      // les références conservées par le superviseur après validation.
      return {bail:Object.freeze(bail),selection:Object.freeze({...valeur.selection}),
        liaison:Object.freeze({...valeur.liaison}),octets};
    },
    async verifier(travail,signal) {
      verifierBail(travail);
      const valeur=await appeler({action:'verifier',version:1,...travail},signal);
      if(!exact(valeur,['autorise']) || valeur.autorise!==true) {return unavailable();}
      return true;
    },
    async reserver(travail,appel,signal) {
      verifierBail(travail);
      if(typeof appel!=='string' || !UUID.test(appel) || Object.values(travail).includes(appel)) {return unavailable();}
      const valeur=await appeler({action:'reserver',version:1,...travail,appel},signal);
      if(!exact(valeur,['reserve']) || valeur.reserve!==true) {return unavailable();}
      return true;
    },
    async enregistrerUsage(travail,appel,usage,signal) {
      verifierBail(travail);
      if(typeof appel!=='string' || !UUID.test(appel) || Object.values(travail).includes(appel)
        || (!exact(usage,['etat']) || usage.etat!=='inconnu') && (!exact(usage,['etat','entree','sortie'])
          || usage.etat!=='mesure' || !Number.isSafeInteger(usage.entree) || usage.entree<0 || usage.entree>5000000
          || !Number.isSafeInteger(usage.sortie) || usage.sortie<0 || usage.sortie>8192)) {return unavailable();}
      const valeur=await appeler({action:'usage',version:1,...travail,appel,usage},signal);
      if(!exact(valeur,['enregistre']) || valeur.enregistre!==true) {return unavailable();}
      return true;
    },
    async terminer(travail,resultat,signal) {
      verifierBail(travail);
      if(!resultat || typeof resultat!=='object' || Array.isArray(resultat)
        || (resultat.statut==='termine' && (!exact(resultat,['statut','texte']) || typeof resultat.texte!=='string'
          || !resultat.texte.trim() || resultat.texte.length>10000 || Buffer.byteLength(resultat.texte,'utf8')>40000))
        || (resultat.statut==='echec_confirme' && !exact(resultat,['statut']))
        || !['termine','echec_confirme'].includes(resultat.statut)) {return unavailable();}
      const valeur=await appeler({action:'terminer',version:1,...travail,resultat},signal);
      if(!exact(valeur,['enregistre']) || valeur.enregistre!==true) {return unavailable();}
      return true;
    },
  };
}
module.exports={creerClientMachineProtegee};
