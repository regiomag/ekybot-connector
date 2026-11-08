'use strict';

/** Nettoyer d'abord localement, y compris pendant une panne du réseau ; un
 * échec de reprise ne doit ni lancer une tâche protégée ni bloquer le cycle
 * classique du compagnon. */
async function cycleCompagnon({protege,reprendre,reconcilier,travailler,signal}) {
  let repriseImpossible = false;
  if (protege) {try {await reprendre();} catch {repriseImpossible = true;}}
  await reconcilier();
  if (repriseImpossible) {throw new Error('protected_recovery_unavailable');}
  if (protege && !signal.aborted) {await travailler();}
}
module.exports = { cycleCompagnon };
