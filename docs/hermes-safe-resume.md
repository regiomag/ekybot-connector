# Continuité des nouvelles sessions Hermes

Le pilote V2 démarre **sans aucun historique ni mémoire Hermes existants**, conformément à la décision du propriétaire du 21 octobre 2026. Il utilisera un profil isolé, une nouvelle conversation et une mémoire vide. Aucun import, résumé de transition ou recherche d’association avec les anciennes sessions n’est requis. L’ancien environnement reste intact et hors du routage V2.

La direction visuelle BMT est validée. Le garde-fou décrit ici prépare la **continuité des futures sessions V2 après leur création**. Il est opt-in et non activé sur le Companion en service. Il ne provisionne pas encore le nouveau profil ni sa première session ; la préparation de ces deux étapes est le prochain incrément.

## Premier démarrage à implémenter

1. Provisionner un profil, un répertoire de travail et un stockage de sessions/mémoire neufs. Refuser tout chemin existant, lien vers l’ancien profil ou copie de mémoire. Ne charger aucun skill personnel ou secret BMT hérité.
2. Définir de nouvelles instructions et les outils autorisés. Vérifier aussi la mémoire globale, les fichiers de contexte des dossiers parents et les variables d’environnement : un nouveau nom de profil ne prouve pas à lui seul l’isolation.
3. Créer la première session avec une demande stable, puis enregistrer durablement l’identifiant natif retourné, le profil et le nouveau canal. Ne jamais déduire cet identifiant d’un titre, d’un préfixe ou de la session la plus récente.
4. Si cette création s’interrompt avec un résultat incertain, suspendre et réconcilier ; ne pas lancer automatiquement une deuxième création.
5. Activer ensuite le contrôle de continuité ci-dessous pour les messages suivants. Partir de zéro une fois ne signifie pas repartir de zéro à chaque message.

Les tests hors modèle précèdent tout essai réel. Un échange consommant des tokens doit être explicitement approuvé ; aucun profil ni session réels n’ont été créés pendant cette recette.

## Identités et contrôle de continuité

Le `sessionId` reçu du relais est une clé logique construite par `buildRelaySessionKey` dans `src/companion-relay-processor.js`, pas l’identifiant natif Hermes. Le garde-fou exige une association locale explicite entre cette clé, le profil, la session créée par V2 et le transport CLI. Une même session ne peut pas être partagée par deux canaux dans le fichier d’associations.

Avant chaque exécution, il lit uniquement les métadonnées SQLite : identifiant exact, profil/source attendus, historique non vide, session terminée, non archivée, non masquée et sans branche descendante. Il n’importe pas Hermes et n’utilise pas son gestionnaire de base pour ce diagnostic. Une session encore vide n’est donc pas admissible : la création initiale doit être qualifiée séparément.

L’exécution utilise `--resume ID --no-restore-cwd`. Aucun repli vers une nouvelle session, un alias ou HTTP. Un verrou exclusif par profil/session et une intention synchronisée sur disque précèdent l’appel au runtime. Tous les workers doivent partager le même répertoire de journal.

Une requête déjà terminée, avec le même identifiant et le même contenu, restitue le résultat enregistré sans nouvel appel après redémarrage. Un changement de contenu ou d’association provoque un conflit. Après timeout, interruption, sortie non nulle, réponse vide, troncature ou persistance non vérifiée, le verrou reste en place et toute relance automatique est interdite. La sortie provisoire disponible est conservée mais jamais présentée comme un succès.

Avant d’enregistrer un succès, le contrôle exige la même base, la même session et une progression de l’historique actif. **Ce contrôle de métadonnées ne prouve pas à lui seul le contexte chargé** : le pilote exige un écrivain exclusif et une qualification sémantique distincte.

Un `systemPrompt` fourni par le relais est refusé en mode strict, car le CLI historique ne l’applique pas. Qualifier les nouvelles instructions du profil ; ne pas supprimer discrètement celles de l’utilisateur.

## Configuration après création vérifiée

Le fichier JSON doit être local, appartenir au compte du Companion, être régulier et privé (`0600`). Le journal doit être un répertoire privé (`0700`), stable, sauvegardé et commun à tous les workers. Exemple fictif, à remplir uniquement avec la session neuve créée par V2 :

```json
{
  "version": 1,
  "bindings": [
    {
      "conversationKey": "agent:ID_AGENT_V2:ekybot-relay-v2:NOUVEAU_CANAL",
      "profile": "ekybot-v2-pilot",
      "sessionId": "ID_NATIF_DE_LA_NOUVELLE_SESSION",
      "transport": "cli"
    }
  ]
}
```

Le diagnostic suivant ne lance aucun processus Hermes, ne charge pas de credentials fournisseur et ne crée ni association ni journal. Il nécessite `sqlite3` avec sortie JSON et un schéma compatible.

```sh
node scripts/hermes-resume-preflight.js --help
node scripts/hermes-resume-preflight.js --bindings /chemin/prive/bindings.json --conversation CLE_EXACTE_DU_NOUVEAU_RELAIS --profile ekybot-v2-pilot
```

`metadataEligible: true` confirme uniquement l’admissibilité des métadonnées, pas l’isolation mémoire ni les instructions appliquées.

Après qualification, l’instance pilote dédiée pourra utiliser :

```dotenv
EKYBOT_HERMES_REQUIRE_RESUME=1
EKYBOT_HERMES_RESUME_BINDINGS_PATH=/chemin/prive/bindings.json
EKYBOT_HERMES_RESUME_STATE_DIR=/chemin/prive/hermes-resume
EKYBOT_HERMES_TRANSPORT=cli
```

`REQUIRE_RESUME` interdit le retour au mode historique si le chemin d’associations manque. Un fichier absent/illisible, un canal non associé ou HTTP forcé bloque l’exécution. **Le mode concerne tous les appels Hermes de cette instance** : ne pas l’activer sur le daemon partagé sans préparer le périmètre des autres canaux. Le chemin historique non configuré reste disponible, mais ne garantit pas la continuité.

Une génération/reset de canal change sa clé et nécessite une nouvelle décision explicite, jamais une réutilisation silencieuse de la session précédente. Les journaux contiennent des réponses privées : ne pas les committer ou les envoyer dans la télémétrie.

## Réconcilier un état incertain

Les verrous n’expirent pas. Ne jamais les effacer automatiquement, changer d’identifiant de requête pour contourner le blocage ou relancer un prompt pour retrouver une réponse.

Suspendre le canal, vérifier le processus et préserver le journal. Comparer le reçu `started` ou `verifying`, la base et la livraison Ekybot. Si une réponse existe, la récupérer et la livrer sans appel modèle après vérification humaine. Sans preuve suffisante, conserver le blocage. Aucun outil de déverrouillage automatique n’est fourni.

Ce mécanisme ne verrouille pas les clients Hermes externes, ne rend pas idempotentes les actions métier de l’agent et ne remplace ni l’autorisation serveur ni une outbox de livraison. HTTP et sessions compressées/ramifiées restent à qualifier. Le runtime inspecté est Hermes `05f548f35dd3242bf2ff74743e9112acde251f77` ; tout changement de CLI/schéma impose une nouvelle qualification.

## Recette reproductible

```sh
node --test tests/*.test.js
```

Au 21 octobre 2026 : **96 tests passent**, dont les validations SQLite sur bases fictives, les arguments CLI avec processus simulé, le rejeu après recréation de l’adaptateur, la concurrence de deux gardes et la mort d’un vrai sous-processus Node pendant une exécution fictive. Aucun processus Hermes ni modèle n’est appelé par les tests.

Le connecteur actif, l’ancienne base, les secrets et les conversations n’ont pas été reconfigurés. La création du profil vide, sa première session et la livraison de bout en bout sont les prochains critères du pilote ; la récupération de l’ancien chat est abandonnée.
