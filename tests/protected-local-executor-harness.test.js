'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const fs = require('node:fs/promises');
const childProcess = require('node:child_process');
const sandbox = require('../src/protected-local-sandbox');
const id = (x) => `${x.repeat(8)}-${x.repeat(4)}-4${x.repeat(3)}-8${x.repeat(3)}-${x.repeat(12)}`;
const liaison = { projet: id('1'), agent: `agent:${id('2')}` };
const message = { contrat: 1, requestId: id('3'), messageId: id('4'), channelId: id('5'), agentId: liaison.agent,
  intention: 'contexte', langue: 'fr', metadata: { projectId: liaison.projet, runId: id('6') },
  donnees: { contrat: 1, retrouver_dans_bmt: 'https://www.bemytalent.com/app/agent-reference',
    capacites: { lectures: ['contexte_v1'], demandes_libres_bmt: false, pieces: false, ecritures: false, paie: false },
    dossier: { reference: id('7'), devise: 'CHF' } } };

test('la sortie est bornée et l’arrêt cible le conteneur, sans transmettre l’environnement du poste', async () => {
  const sauvegarde = { spawn: childProcess.spawn, execFile: childProcess.execFile, realpath: fs.realpath,
    stat: fs.stat, mkdtemp: fs.mkdtemp, rm: fs.rm, plan: sandbox.planProtectedLocalRuntime };
  const appels = []; let entree = '', enfant;
  try {
    sandbox.planProtectedLocalRuntime = () => sandbox.buildIsolatedContainerArgs(id('6'), `sha256:${'a'.repeat(64)}`);
    fs.realpath = async () => '/tmp/socket-fictif'; fs.stat = async () => ({ isSocket: () => true });
    fs.mkdtemp = async () => '/tmp/repertoire-fictif'; fs.rm = async () => {};
    childProcess.spawn = (_bin, args, options) => {
      appels.push({ args, options }); enfant = new EventEmitter(); enfant.stdout = new PassThrough();
      enfant.stdin = new Writable({ write(chunk, _enc, callback) { entree += chunk.toString(); callback(); } });
      enfant.kill = () => { enfant.stdout.destroy(); enfant.emit('close', 137); return true; };
      return enfant;
    };
    childProcess.execFile = (_bin, args, _options, cb) => { appels.push({ arret: args }); cb(null, '', ''); };
    delete require.cache[require.resolve('../src/protected-local-executor')];
    const { executerAgentLocalProtege } = require('../src/protected-local-executor');
    const controle = new AbortController();
    const travail = executerAgentLocalProtege({ runtime: 'runtime-fictif', runId: id('6'),
      octets: Buffer.from(JSON.stringify(message)), liaison, socket: '/tmp/socket-fictif', docker: '/usr/bin/docker',
      limiteAppels: 1, verifierDroits: async () => {}, appelerModele: async () => 'fictif', signal: controle.signal });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(enfant); controle.abort();
    await assert.rejects(travail, /protected_runtime_unavailable/);
    assert.deepEqual(Object.keys(appels[0].options.env).sort(), ['HOME', 'PATH']);
    assert.ok(appels[0].args.includes('--network=none'));
    assert.ok(appels.some((a) => a.arret?.includes('kill') && a.arret.includes(`bmt-protected-${id('6')}`)));
    assert.deepEqual(JSON.parse(entree), { type: 'demarrer', message });
  } finally {
    childProcess.spawn = sauvegarde.spawn; childProcess.execFile = sauvegarde.execFile; fs.realpath = sauvegarde.realpath;
    fs.stat = sauvegarde.stat; fs.mkdtemp = sauvegarde.mkdtemp; fs.rm = sauvegarde.rm;
    sandbox.planProtectedLocalRuntime = sauvegarde.plan;
    delete require.cache[require.resolve('../src/protected-local-executor')];
  }
});
