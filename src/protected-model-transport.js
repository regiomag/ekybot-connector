'use strict';

const MAX_REPONSE = 96 * 1024;
const MAX_QUESTION = 64 * 1024;
const unavailable = () => { throw new Error('protected_model_unavailable'); };

function analyserEndpoint(endpoint) {
  if (typeof endpoint !== 'string') {return unavailable();}
  let url;
  try {url = new URL(endpoint);} catch {return unavailable();}
  const local = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash
    || !url.pathname.endsWith('/chat/completions') || url.href !== endpoint) {return unavailable();}
  return {endpoint:url.href,local};
}

/** La configuration vient exclusivement du poste et de l'agent sélectionné.
 * Aucune destination, aucun modèle ni aucun identifiant n'est accepté depuis
 * le conteneur. Une connexion API explicite n'est pas un abonnement CLI. */
function creerTransportModeleProtege({ configuration, obtenirCle, envoyer = fetch }) {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)
    || Object.keys(configuration).sort().join(',') !== 'endpoint,limite,mode,modele,parametreLimite'
    || configuration.mode !== 'api-compatible-explicite' || typeof configuration.endpoint !== 'string'
    || typeof configuration.modele !== 'string' || !configuration.modele.trim() || configuration.modele.length > 128
    || [...configuration.modele].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || !Number.isInteger(configuration.limite)
    || configuration.limite < 1 || configuration.limite > 8192
    || !['max_tokens', 'max_completion_tokens'].includes(configuration.parametreLimite)
    || typeof obtenirCle !== 'function' || typeof envoyer !== 'function') {return unavailable();}
  // HTTP n'est admis que pour une adresse locale littérale, jamais via DNS.
  const { endpoint,local } = analyserEndpoint(configuration.endpoint);
  const modele = configuration.modele, limite = configuration.limite;
  const parametreLimite = configuration.parametreLimite;

  return async function appeler(question, signal) {
    try {
      if (typeof question !== 'string' || !question.trim() || Buffer.byteLength(question, 'utf8') > MAX_QUESTION
        || !(signal instanceof AbortSignal) || signal.aborted) {return unavailable();}
      const cle = await obtenirCle();
      if ((cle !== null || !local) && (typeof cle !== 'string' || cle.length < 1 || cle.length > 4096 || /[\r\n]/.test(cle))
        || signal.aborted) {return unavailable();}
      const corps = { model: modele, messages: [{ role: 'user', content: question }], stream: false,
        [parametreLimite]: limite };
      const reponse = await envoyer(endpoint, { method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', ...(cle === null ? {} : { 'Authorization': `Bearer ${cle}` }) }, body: JSON.stringify(corps) });
      if (!reponse || reponse.status !== 200 || reponse.redirected || !reponse.headers
        || reponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
        || !reponse.body || typeof reponse.body.getReader !== 'function') {return unavailable();}
      const longueur = reponse.headers.get('content-length');
      if (longueur !== null && (!/^\d+$/.test(longueur) || Number(longueur) > MAX_REPONSE)) {return unavailable();}
      const lecteur = reponse.body.getReader();
      const morceaux = []; let total = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          const { done, value } = await lecteur.read();
          if (done) {break;}
          if (!(value instanceof Uint8Array) || (total += value.byteLength) > MAX_REPONSE) {return unavailable();}
          morceaux.push(value);
        }
      } finally {void lecteur.cancel().catch(() => {});try {lecteur.releaseLock();} catch { /* Lecture annulée. */ }}
      signal.throwIfAborted();
      const resultat = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(morceaux)));
      const choix = resultat?.choices;
      if (!Array.isArray(choix) || choix.length !== 1 || choix[0]?.message?.role !== 'assistant'
        || typeof choix[0].message.content !== 'string' || !choix[0].message.content.trim()
        || choix[0].message.content.length > 10000 || Buffer.byteLength(choix[0].message.content, 'utf8') > 40000
        || choix[0].message.tool_calls || choix[0].message.function_call || choix[0].message.refusal) {return unavailable();}
      return choix[0].message.content;
    } catch {return unavailable();}
  };
}

module.exports = { analyserEndpoint,creerTransportModeleProtege };
