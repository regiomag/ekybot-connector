# Outils de développement à distance du Companion

Cette base expérimentale permet à une session native Codex ou Claude Code d'utiliser les mêmes outils de fichiers, sans ouvrir leurs outils intégrés ni changer les conversations de production. Elle n'est reliée ni à la file serveur Ekybot ni à une interface d'approbation et ne constitue pas encore un mode de développement utilisable depuis le téléphone.

## Architecture et périmètre

`development-tools` définit un contrat unique, exécuté par `DevelopmentBroker`. Codex l'utilise via les outils dynamiques de son app-server ; Claude Code via un serveur MCP local fixe, connecté au broker par socket Unix privée et capacité temporaire. Les adaptateurs réutilisent le journal durable existant. Les appels natifs sans option `development` gardent leur politique de dialogue actuelle.

Les fichiers sont limités au dossier lié pour les agents de code. La politique préparée pour Hermes permet la lecture de dossiers ordinaires du Mac, sans donner aux agents délégués cette portée. L'adaptateur Hermes et la délégation effective restent à raccorder. Les secrets connus et répertoires d'authentification sont refusés ; cette protection applicative ne constitue pas une isolation contre un utilisateur local malveillant ni un détecteur universel de secrets.

Chaque modification conserve une copie privée de récupération avant son effet. Les opérations sont sérialisées et leurs reçus persistent localement. Un résultat incertain bloque les nouvelles mutations du même run, y compris après reconstruction du broker ; la lecture reste possible pour constater les effets. Les erreurs des sous-processus ne sont pas exposées au modèle. La création de worktrees séparés est préparée sans déplacement des changements locaux du propriétaire.

## Recettes réalisées

Le 22 octobre 2026, les CLI natifs Codex `0.155.0` et Claude Code `2.1.285` ont chacun réussi deux tours sur un dossier synthétique privé : lecture d'un code dans `fixture.txt`, création d'`answer.txt`, fermeture du processus, reprise de la même session puis relecture. Ces essais utilisent les abonnements connectés et consomment une petite quantité de leur quota ; ils n'utilisent aucun dépôt métier ni secret de projet.

La recette se reproduit explicitement avec `node scripts/qualify-development-native.js codex` ou `claude`. Elle conserve ses fixtures pour inspection et ne constitue pas un test automatique sans consommation.

Les tests ciblés couvrent notamment les chemins hors projet, liens symboliques, secrets connus, reçus, récupération, annulation pendant une approbation et interdiction de rejouer une action incertaine avec un autre identifiant. La suite générale utilise les dépendances Node du projet et un interpréteur Python 3 explicite via `EKYBOT_PROBE_PYTHON` pour les fixtures Hermes. Les tests HTTP nécessitent le loopback local ; aucun modèle n'est appelé par cette suite standard.

## Limites avant livraison

- Les commandes système sont désactivées et non annoncées parmi les outils disponibles. Le premier profil sandbox macOS n'a pas exécuté correctement une commande bénigne. Qualifier une bibliothèque de sandbox maintenue, avec tests de lecture, écriture, réseau et annulation des sous-processus, avant de les activer. Ne jamais retomber sur un shell non isolé.
- Les demandes d'approbation sont des callbacks de test, pas encore des décisions durables prises depuis le téléphone. Qualifier les changements de fichiers entre approbation et commit, l'identité du remote avant push et les interruptions avant de livrer Git en production.
- Aucun catalogue de projets de l'utilisateur, worker de développement ou canal de production n'est activé. Restent la liaison serveur/canal/projet, les événements, annulations et approbations UI, puis les recettes bout en bout et le déploiement.
- L'arrêt avec un outil en attente et la concurrence de plusieurs workers sur le même projet restent à qualifier. Ne pas exposer ce prototype à plusieurs utilisateurs ou à des projets non fiables.
- Aucun moteur de mémoire partagé n'est installé. Mem0 OSS est le candidat de qualification consigné dans la spec Ekybot ; les sessions natives et le futur carnet partagé sont deux couches distinctes. Aucun historique V1 n'est importé.

Les services launchd existants et le déploiement Vercel restent inchangés par ce lot. Le passage en production exige ces étapes restantes ; un commit de cette base ne vaut pas activation.
