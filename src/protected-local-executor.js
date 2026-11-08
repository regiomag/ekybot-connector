'use strict';

const { spawn, execFile } = require('node:child_process');
const { mkdtemp, rm, realpath, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, isAbsolute } = require('node:path');
const { promisify } = require('node:util');
const { planProtectedLocalRuntime } = require('./protected-local-sandbox');
const { verifierMessageLocalProtege } = require('./protected-local-contract');
const { creerPontLocalProtege } = require('./protected-local-broker');
const { servirProtocoleProtege } = require('./protected-local-protocol');

const executer = promisify(execFile);
const DOCKER_BINARIES = Object.freeze(['/usr/bin/docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker']);
const unavailable = () => { throw new Error('protected_runtime_unavailable'); };

/** Prototype non connecté à une route. Seule une image inscrite au registre
 * interne peut démarrer ; aucune n'est encore qualifiée. Le pont ne change
 * jamais le modèle choisi et ne transmet pas ses identifiants au conteneur. */
async function executerAgentLocalProtege({ runtime, runId, octets, liaison, socket, docker, appelerModele,
  verifierDroits, limiteAppels, delaiMs = 120000, signal }) {
  let enfant, repertoire, timer, nom, annuler;
  let termine = false;
  const controle = new AbortController();
  try {
    // Refus avant toute lecture ou lancement tant que le runtime n'est pas qualifié.
    const args = planProtectedLocalRuntime(runtime, runId);
    const message = verifierMessageLocalProtege(octets, liaison);
    if (message.metadata.runId !== runId || typeof verifierDroits !== 'function'
      || !DOCKER_BINARIES.includes(docker) || typeof socket !== 'string' || !isAbsolute(socket)
      || !Number.isInteger(delaiMs) || delaiMs < 1000 || delaiMs > 300000
      || (signal !== undefined && !(signal instanceof AbortSignal)) || signal?.aborted) {return unavailable();}
    const socketReel = await realpath(socket);
    if (!(await stat(socketReel)).isSocket()) {return unavailable();}
    const pont = creerPontLocalProtege({ limiteAppels, delaiMs: Math.min(delaiMs, 120000), signal: controle.signal,
      appelerModele: async (question, signalModele) => {
        await verifierDroits();
        if (signalModele.aborted) {return unavailable();}
        return await appelerModele(question, signalModele);
      } });
    if (typeof appelerModele !== 'function') {return unavailable();}
    await verifierDroits();
    repertoire = await mkdtemp(join(tmpdir(), 'bmt-protected-docker-'));
    if (signal?.aborted) {return unavailable();}
    const env = { PATH: '/usr/bin:/bin', HOME: repertoire };
    const commun = ['--config', repertoire, '--host', `unix://${socketReel}`];
    nom = `bmt-protected-${runId}`;
    enfant = spawn(docker, [...commun, ...args], { cwd: repertoire, env, stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    enfant.stdin.on('error', () => {});
    const fin = new Promise((resolve, reject) => {
      enfant.once('error', reject);
      enfant.once('close', (code) => { termine = true; if (code === 0) {resolve();} else {reject(new Error());} });
    });
    // Jamais d'identifiant réel ni de demande libre dans cette entrée validée.
    enfant.stdin.write(`${JSON.stringify({ type: 'demarrer', message })}\n`);
    const protocole = servirProtocoleProtege(enfant.stdout, enfant.stdin, pont);
    const limite = new Promise((_, reject) => { timer = setTimeout(() => { controle.abort(); reject(new Error()); }, delaiMs); });
    const annulation = new Promise((_, reject) => {
      annuler = () => { controle.abort(); reject(new Error()); };
      if (signal?.aborted) {annuler();} else {signal?.addEventListener('abort', annuler, { once: true });}
    });
    const [texte] = await Promise.race([Promise.all([protocole, fin]), limite, annulation]);
    await verifierDroits();
    if (controle.signal.aborted || signal?.aborted) {return unavailable();}
    return { texte };
  } catch { return unavailable(); }
  finally {
    clearTimeout(timer);
    controle.abort();
    if (annuler) {signal?.removeEventListener('abort', annuler);}
    if (enfant && !termine) {
      // Couper le conteneur lui-même ; tuer le seul client Docker ne suffit pas.
      try {
        await executer(docker, ['--config', repertoire, '--host', `unix://${await realpath(socket)}`, 'kill', nom],
          { cwd: repertoire, env: { PATH: '/usr/bin:/bin', HOME: repertoire }, timeout: 5000 });
      } catch { /* La qualification doit traiter le cas d'un démon indisponible. */ }
      enfant.kill('SIGKILL');
    }
    if (repertoire) {await rm(repertoire, { recursive: true, force: true }).catch(() => {});}
  }
}

module.exports = { executerAgentLocalProtege };
