# BMT : progression Claude 2.1.285

Le compagnon interrompait les conversations Claude lorsque le CLI émettait `system/thinking_tokens`, un événement de progression qui n’était pas encore qualifié par l’adaptateur. Le run métier devenait `uncertain` avant de recevoir sa réponse.

Le correctif reconnaît uniquement cet événement avec un UUID valide, le même `session_id` et `user_message_uuid` que la demande, et des compteurs entiers bornés non négatifs. Cette progression ne remplace ni l’accusé du message utilisateur ni le résultat final. Les contrôles des outils, des permissions, de la persistance et de la continuation restent obligatoires. Les événements inconnus ou malformés restent refusés.

Qualification : 38 tests ciblés BMT, politique, Claude et journal natif ; tests de progression avant initialisation/après résultat, mauvaise identité, compteurs invalides et absence de réponse finale. Une reprise dans une branche de test distincte de Demo a émis deux vrais événements `thinking_tokens` (50 puis 239 jetons estimés), puis un résultat final validé. La session Demo d’origine n’a pas été modifiée par ce test et sa demande métier n’a pas été rejouée.

La mise à jour du seul service BMT réutilise son installation de dépendances existante uniquement si le lockfile correspond exactement à celui de la nouvelle release. L’ancien chemin de dépendances qualifiées développement reste disponible pour les releases plus anciennes. Les journaux, sessions, authentifications et clés ne sont ni copiés dans la nouvelle release ni réinitialisés par la mise à jour.

Les runs déjà interrompus restent à réconcilier explicitement. Ce correctif ne les annule pas et ne les relance pas automatiquement.

## Installation et recette réelles

Le propriétaire a explicitement autorisé la pause BMT avec reprise automatique, l’installation et la réconciliation des deux runs interrompus. Le 22 octobre 2026, la release `bmt-companion-c008e22` a remplacé `bmt-companion-e4a99e9` pour le seul service `com.ekybot.bmt-v2`. Tous les fichiers d’état surveillés étaient identiques avant/après installation. Les sessions interrompues sont archivées avec manifeste SHA-256 (six fichiers Ekylibr, huit fichiers Demo) ; les droits et les clés sont inchangés. Le service a repris avec `bmt_paused=false`.

Deux nouveaux tests ont été envoyés depuis l’interface BMT, sans données métier ni outils. Claude-Ekylibr a répondu `OK_BMT_EKYLIBR`, reçu automatiquement dans BMT à 14:51:35 (Europe/Zurich). Claude BMT — Demo a répondu `OK_BMT_DEMO`, reçu automatiquement à 14:53:35. Les deux runs sont terminés avec zéro action métier, un reçu de callback chacun et une source toujours autorisée. Aucune livraison manuelle n’a été utilisée pour ces tests et aucune demande d’origine n’a été rejouée.

Les anciens runs ont été clos par annulation technique après contrôle de l’absence de résultat et d’action. Le retour arrière conserve l’ancienne release et le plist `com.ekybot.bmt-v2.plist.before-c008e22` ; ne pas supprimer les archives ni rejouer un ancien run.
