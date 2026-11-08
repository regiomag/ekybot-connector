'use strict';

// Aucune image n'est qualifiée pour l'instant. Ce registre est du code vérifié,
// jamais une valeur transmise par l'agent ou une variable d'environnement.
const QUALIFIED_RUNTIMES = Object.freeze({});
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IMAGE = /^sha256:[0-9a-f]{64}$/;

/** Paramètres d'une boîte locale éphémère. Pas de montage, d'historique, de
 * secret, d'accès réseau ou de téléchargement implicite. Le dialogue éventuel
 * avec un modèle devra passer par un pont local qualifié séparément. */
function buildIsolatedContainerArgs(runId, image) {
  if (typeof runId !== 'string' || !ID.test(runId) || typeof image !== 'string' || !IMAGE.test(image)) {
    throw new Error('protected_runtime_unavailable');
  }
  return Object.freeze([
    'run', '--rm', '--interactive', '--name', `bmt-protected-${runId}`,
    // Docker crée un espace PID privé par défaut ; "--pid=private" n'existe pas.
    '--pull=never', '--network=none', '--ipc=none',
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
    '--pids-limit=32', '--memory=512m', '--cpus=1', '--user=65534:65534',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m',
    '--env', 'HOME=/tmp', '--env', 'LANG=C.UTF-8', '--log-driver=none', image,
  ]);
}

/** Une configuration extérieure ne peut pas qualifier un runtime. Tant que
 * son image et le pont du modèle ne sont pas vérifiés, refuser avant spawn. */
function planProtectedLocalRuntime(runtime, runId) {
  if (typeof runtime !== 'string' || !Object.hasOwn(QUALIFIED_RUNTIMES, runtime)) {
    throw new Error('protected_runtime_unavailable');
  }
  return buildIsolatedContainerArgs(runId, QUALIFIED_RUNTIMES[runtime]);
}

module.exports = { buildIsolatedContainerArgs, planProtectedLocalRuntime };
