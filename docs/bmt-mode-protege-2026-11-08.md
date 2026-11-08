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

## Avancement local du 8 novembre

Un premier programme de runtime construit une question prédéfinie à partir du
seul contrat structuré, puis communique par le pont stdin/stdout. Un transport
HTTPS compatible Chat Completions prend sa destination, son modèle, sa limite
et sa clé dans une configuration locale explicite ; ni l'agent isolé ni son
message ne peuvent les choisir. Il ne suit pas les redirections et ne rejoue
pas les appels. Ce transport concerne une configuration API explicite : il ne
représente ni Codex ni Claude, et ne réutilise pas leur abonnement.

Le programme préparé pour le compagnon écrit avant lancement un journal local
ne contenant que des références techniques et l'empreinte du démon. Un verrou
système exclusif est libéré à la fin du processus ; au redémarrage, le
superviseur vérifie l'identité du démon et arrête, si nécessaire, les seuls
conteneurs inscrits avant de permettre une nouvelle exécution. Si le démon ou
l'arrêt est incertain, le journal demeure et le travail n'est pas déclaré
terminé. Les contrôles de reprise ont utilisé un verrou réel et un démon
simulé ; aucun conteneur réel n'a été qualifié à ce stade.

À faire : construire et qualifier une image locale reproductible, définir la
configuration liée à chaque agent et le transport authentifié vers le compagnon,
vérifier les interruptions et les refus sur un vrai démon, puis effectuer les
essais intégrés. Codex/Claude nécessitent leurs adaptateurs propres ; ne pas
substituer un fournisseur ou une facturation. Le registre d'images et les
gates restent fermés, et les tests précédents ne constituent pas une mise en
production.

La sélection du prototype API exige désormais un fichier local privé et un
agent, fournisseur et modèle strictement identiques à la sélection autorisée.
Le fichier ne contient que le nom de la variable locale contenant la clé ; la
clé reste côté compagnon. La configuration et le transport authentifié depuis
Ekybot ne sont pas encore exposés à l'utilisateur et aucun runtime n'est
qualifié. Le contrôle des droits BMT avant chaque appel modèle doit encore être
raccordé par le transport machine.

Le compagnon possède un client séparé du relais classique et un travailleur
qui demandent une tâche, recontrôlent les droits avant le runtime et chaque
appel modèle, puis confirment le résultat. La clé machine et les paramètres
locaux ne sont jamais transmis au conteneur. Le client et la route serveur
ne sont pas encore reliés : leur contrat préparé ne doit pas être ouvert tant
que l'affectation transactionnelle à une machine, les droits BMT et le budget
n'y sont pas vérifiés. Une réponse réseau incertaine ne relance pas l'agent.
Un contexte d'image minimal peut être préparé depuis une base désignée par
empreinte ; aucune image n'est construite, certifiée ou activée automatiquement.

Le cycle de la machine est préparé dans la boucle du compagnon existante : il
ne crée ni nouveau service hébergé ni nouvelle planification. Une constante
reste à `false`, indépendamment des variables d'environnement ; le cycle ne
peut donc pas être activé avant qualification. L'arrêt du compagnon transmet
une annulation au travail en cours et attend la fin du cycle. L'image n'a pas
encore été construite ni vérifiée sur un démon réel.

À chaque passage activé, la reprise locale précède désormais la demande de
tâche : un ancien conteneur inscrit est recherché et arrêté même si aucune
nouvelle tâche n'attend. Si l'identité du démon ou l'arrêt ne peuvent pas être
confirmés, aucune tâche n'est réclamée. Cette reprise reste derrière la même
constante fermée et doit encore être vérifiée sur un démon réel.
Elle est également lancée avant la synchronisation réseau du compagnon : une
panne de réseau ne doit pas empêcher le nettoyage local. En cas d'échec, le
cycle classique reste accessible, mais aucune tâche protégée n'est lancée.

Le transport API préparé accepte aussi un modèle explicitement configuré sur
une adresse HTTP littérale de boucle locale (`127.0.0.1` ou `::1`). Il refuse
les noms DNS et autres adresses en HTTP. L'opérateur reste responsable du
service effectivement à l'écoute ; cette option ne constitue pas, à elle
seule, une qualification ni une activation du parcours.
Si ce service local ne demande pas de clé, la configuration privée peut
explicitement omettre l'authentification ; une destination distante exige
toujours une clé.

Une première qualification a été exécutée dans une VM locale dédiée sans
montage du poste, sur architecture ARM64 : exécution de l'image avec un modèle
HTTP fictif local, absence d'interface réseau autre que `lo`, PID privé,
utilisateur non privilégié, système de fichiers en lecture seule, absence du
socket Docker et des variables du poste, puis récupération après interruption
brutale. Elle a permis de corriger une option Docker invalide et les droits des
fichiers de l'image. `scripts/qualifier-runtime-local.js` permet de refaire
l'essai d'exécution avec le socket, l'empreinte de l'image locale et le chemin
du binaire Docker, explicitement fournis. Cette preuve est limitée à cette
machine et à cette image de test : la distribution d'une image qualifiée, les
autres plateformes, le suivi des coûts et la recette complète restent requis.
Le registre et les gates demeurent fermés.

Le compagnon réserve désormais l'appel modèle avant son émission, puis remet
les seuls compteurs bornés au serveur. Une réponse sans compteurs est notée
inconnue et une interruption laisse la réservation incertaine ; aucune reprise
automatique ne suppose que l'appel était gratuit ou n'a pas été facturé.
Les valeurs métier et le texte de la question ne figurent pas dans ce suivi.
La réponse du fournisseur doit confirmer exactement le modèle sélectionné.
Une autre identité, ou une identité absente, est refusée et son coût est
signalé comme inconnu : on ne lui applique pas silencieusement un tarif qui
pourrait appartenir à un autre modèle.
