# BMT : progression Claude 2.1.285

Le compagnon interrompait les conversations Claude lorsque le CLI émettait `system/thinking_tokens`, un événement de progression qui n’était pas encore qualifié par l’adaptateur. Le run métier devenait `uncertain` avant de recevoir sa réponse.

Le correctif reconnaît uniquement cet événement avec un UUID valide, le même `session_id` et `user_message_uuid` que la demande, et des compteurs entiers bornés non négatifs. Cette progression ne remplace ni l’accusé du message utilisateur ni le résultat final. Les contrôles des outils, des permissions, de la persistance et de la continuation restent obligatoires. Les événements inconnus ou malformés restent refusés.

Qualification : 38 tests ciblés BMT, politique, Claude et journal natif ; tests de progression avant initialisation/après résultat, mauvaise identité, compteurs invalides et absence de réponse finale. Une reprise dans une branche de test distincte de Demo a émis deux vrais événements `thinking_tokens` (50 puis 239 jetons estimés), puis un résultat final validé. La session Demo d’origine n’a pas été modifiée par ce test et sa demande métier n’a pas été rejouée.

La mise à jour du seul service BMT réutilise son installation de dépendances existante uniquement si le lockfile correspond exactement à celui de la nouvelle release. L’ancien chemin de dépendances qualifiées développement reste disponible pour les releases plus anciennes. Les journaux, sessions, authentifications et clés ne sont ni copiés dans la nouvelle release ni réinitialisés par la mise à jour.

Les runs déjà interrompus restent à réconcilier explicitement. Ce correctif ne les annule pas et ne les relance pas automatiquement.
