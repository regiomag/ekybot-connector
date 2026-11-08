# Demandes BMT protégées — garde du compagnon

État : garde expérimentale, non déployée. Le compagnon actuel enrichit les
demandes avec des mémoires et peut utiliser un espace de travail, des
instructions et des outils existants. Une nouvelle clé de session ne suffit
donc pas à garantir l'isolement des données.

Le processeur refuse toute notification qui porte un champ `protectedMode`,
à la racine ou dans `relay`, quelle que soit sa valeur. Le refus intervient
avant le routage, l'enrichissement et l'appel du modèle ; l'accusé utilise un
code fixe sans contenu de la demande. Une panne de l'accusé laisse la demande
refusée au passage suivant. Les requêtes classiques gardent leur chemin.

Les adaptateurs locaux actuels ne satisfont pas le contrat d'isolement :
Codex reçoit l'environnement du compagnon et un répertoire de travail, et
Claude Code reçoit également l'environnement et utilise des permissions
élargies. Un répertoire temporaire ou une nouvelle session ne prouve pas
qu'ils ne peuvent lire d'autres fichiers, réglages, mémoires ou outils. Ne
pas qualifier ces adaptateurs par un simple changement d'arguments ; fournir
un runtime isolé vérifiable et tester ses accès effectifs avant activation.

Cette garde ne protège pas un message dont le marqueur aurait été perdu en
amont. L'entrée protégée Ekybot et le parcours BMT restent fermés : leur futur
contrat doit garantir la conservation et la vérification du marqueur à chaque
reprise. Avant toute activation, il faut également un runtime et une session
isolés, sans mémoire, outils, espace de travail ou instructions classiques,
ainsi que des vérifications intégrées du rappel, des droits et de la révocation.

Le prototype de boîte locale interdit réseau, montages, privilèges, logs de
conteneur et téléchargement implicite ; il ne transmet aucun secret ni
environnement du poste. Son registre d'images qualifiées est vide et le
relais historique refuse toujours les demandes protégées. Un protocole local
et un pont injectable bornent les appels au modèle sélectionné sans exposer
ses identifiants ; ils ne sont pas encore raccordés à Codex ni à Claude.
L'arrêt effectif des processus, la vérification des images et les essais
d'isolation restent nécessaires. Aucun prestataire d'isolation hébergé n'est
prévu ; le modèle choisi conserve son fournisseur et ses propres conditions.

Pour Codex, la documentation officielle décrit un app-server piloté en
stdin/stdout, avec un fournisseur Responses configuré et un jeton OAuth :
https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server.
Le pont local expérimental ne transporte encore qu'une question et une réponse
textuelles ; il ne met pas en œuvre ce protocole Responses ni la connexion
ChatGPT. Il ne faut donc pas le présenter comme compatible avec Codex ou comme
une conservation automatique de l'abonnement existant. Un adaptateur dédié,
sa gestion des flux et des autorisations et des essais sur image locale restent
nécessaires. Aucun changement de fournisseur ou de facturation ne doit être
fait silencieusement.

Si le client Docker s'interrompt anormalement, le prototype essaie désormais
explicitement d'arrêter le conteneur et vérifie qu'il n'est plus en cours. Si
le démon est inaccessible ou que l'arrêt ne peut pas être constaté, il signale
un arrêt incertain : cela ne prouve pas qu'un conteneur orphelin est arrêté.
La détection durable au redémarrage, sa récupération exclusive et un essai sur
un vrai démon restent à réaliser avant toute qualification ou activation.
