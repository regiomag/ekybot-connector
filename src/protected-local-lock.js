'use strict';
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { once } = require('node:events');

/** Verrou détenu par le noyau, relâché à la mort du processus auxiliaire.
 * Le fichier de verrou n'est jamais supprimé : tous les clients verrouillent
 * le même inode. L'auxiliaire quitte à la fermeture du tube de son parent. */
async function verrouillerSuperviseur(repertoire) {
  const executable = process.platform === 'darwin' ? '/usr/bin/lockf' : process.platform === 'linux' ? '/usr/bin/flock' : null;
  if (!executable || typeof repertoire !== 'string') {throw new Error('protected_lock_unavailable');}
  const chemin = join(repertoire, 'supervisor.lock');
  const helper = "process.stdout.write('OK\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));";
  const args = process.platform === 'darwin'
    ? ['-k', '-s', '-t', '0', chemin, process.execPath, '-e', helper]
    : ['-n', chemin, process.execPath, '-e', helper];
  const enfant = spawn(executable, args, { cwd:repertoire,env:{ PATH:'/usr/bin:/bin' },stdio:['pipe','pipe','ignore'],shell:false });
  const controle = new AbortController();
  enfant.once('error', () => controle.abort());
  enfant.once('exit', () => controle.abort());
  enfant.stdin.on('error', () => {});
  let delai;
  try {
    const recu = await Promise.race([
      once(enfant.stdout, 'data').then(([data]) => data.toString()),
      once(enfant, 'exit').then(() => ''),
      new Promise(resolve => {delai = setTimeout(() => resolve(''), 3000);}),
    ]);
    if (recu !== 'OK\n' || controle.signal.aborted) {throw new Error();}
  } catch {
    enfant.stdin.end();enfant.kill('SIGKILL');throw new Error('protected_lock_unavailable');
  } finally {clearTimeout(delai);}
  let ferme = false;
  return {
    signal:controle.signal,
    async fermer() {
      if (ferme) {return;}
      ferme = true;enfant.stdin.end();
      if (enfant.exitCode !== null || enfant.signalCode !== null) {return;}
      let temporisateur;
      const fermeCorrectement = await Promise.race([
        once(enfant, 'exit').then(() => true),
        new Promise(resolve => {temporisateur = setTimeout(() => resolve(false), 3000);}),
      ]).finally(() => clearTimeout(temporisateur));
      if (!fermeCorrectement) {enfant.kill('SIGKILL');throw new Error('protected_lock_unavailable');}
    },
  };
}
module.exports = { verrouillerSuperviseur };
