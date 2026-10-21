# Continuité des nouvelles sessions Hermes

Le pilote V2 démarre **sans aucun historique ni mémoire Hermes existants**, conformément à la décision du propriétaire du 21 octobre 2026. Il utilisera un profil isolé, une nouvelle conversation et une mémoire vide. Aucun import, résumé de transition ou recherche d’association avec les anciennes sessions n’est requis. L’ancien environnement reste intact et hors du routage V2.

La direction visuelle BMT est validée. Le garde-fou décrit ici prépare la **continuité des futures sessions V2 après leur création**. Il est opt-in et non activé sur le Companion en service. Un provisionneur distinct prépare désormais le profil vide hors ligne ; il ne crée pas encore de session native et n’active aucun runtime.

## Profil vide préparé

Le 21 octobre 2026, le profil `ekybot-v2-pilot` a été créé dans `/Users/ekytec/.local/share/ekybot-v2/hermes/profiles/ekybot-v2-pilot`. La racine est distincte de `~/.hermes` et `~/.openclaw`, avec un nouveau dossier de travail. `MEMORY.md`, `USER.md` et `.env` sont vides ; aucun historique, skill, plugin ou secret n’est importé. `SOUL.md` contient uniquement de nouvelles instructions minimales, sans information personnelle. Les répertoires sont privés (`0700`) et les fichiers privés (`0600`).

```sh
node scripts/hermes-prepare-profile.js --plan
node scripts/hermes-prepare-profile.js --create
node scripts/hermes-prepare-profile.js --check
```

`--create` refuse un profil existant, même vide ou partiellement créé : aucun écrasement ou nettoyage implicite. `--check` vérifie les fichiers attendus, leurs empreintes, permissions et répertoires vides. Le statut est **`prepared-offline`**, pas « prêt à discuter ». Le marqueur `.ekybot-prepared-offline.json` et la racine personnalisée bloquent les appels du client CLI modifié avant tout lancement. Ne pas supprimer ce marqueur pour forcer l’activation. Les réglages du daemon en service ne sont pas modifiés.

La création native `hermes profile create` n’est pas utilisée : dans le runtime inspecté, elle recopie par défaut le bloc modèle du profil actif et peut semer des skills. Le démarrage CLI lit aussi le `.env` du dépôt Hermes comme complément, et les profils habituels peuvent retomber sur des réglages de la racine commune. La racine distincte élimine une source d’héritage, mais l’environnement du lanceur et les credentials restent à qualifier avant activation.

Le diagnostic `scripts/hermes-profile-isolation-probe.py` passe sur un profil temporaire et sur le profil pilote réel, avec les lecteurs natifs de Hermes. Il confirme une mémoire et une mémoire utilisateur vides, aucun contexte de projet chargé et aucun skill externe. Les inspections `--check` avant et après confirment les mêmes fichiers, empreintes et permissions, sans session créée. Aucun appel modèle.

**Ce résultat porte sur les lecteurs, pas sur le démarrage du CLI.** Le lecteur natif `load_soul_md()` appelle aussi `ensure_hermes_home()`, qui crée des dossiers et applique des permissions. Il est donc exclu de cette recette strictement sans écriture ; son initialisation n’est ni simulée ni neutralisée pour faire passer le contrôle. La seule opération `mkdir` admise vise le dossier `memories` déjà présent, non symbolique. Le démarrage natif et le chargement de `SOUL.md`, `.env`, credentials et plugins restent à qualifier séparément sur un profil jetable avant activation du pilote.

Un deuxième mode, `--bootstrap-fixture`, qualifie maintenant l’initialisation native sur un export Git propre et un profil jetable privés sous le répertoire temporaire. `ensure_hermes_home()`, `load_hermes_dotenv()`, `load_config()` et `load_soul_md()` passent : seuls cinq dossiers natifs sont ajoutés, les fichiers initiaux restent inchangés, la mémoire reste vide et aucun modèle ni secret n’est chargé. Ce mode refuse le profil réel, un runtime contenant `.env`, toute écriture de fichier et les créations de dossiers hors liste. Le CLI de chat, l’authentification et la première session restent à qualifier.

Le contrôle Python interrompt les accès réseau, sous-processus, écritures et lectures de secrets/anciens contextes couverts par ses règles. Il résout aussi les liens symboliques pour les lectures. C’est un détecteur d’effets indésirables pendant cette recette, **pas une sandbox de sécurité du processus**. Vingt tests sur modules fictifs vérifient ses refus et le périmètre annoncé ; ils ne remplacent pas la recette native.

Commande native utilisée sur le Mac, dans un environnement sans credentials et sans écriture de bytecode :

```sh
node scripts/hermes-prepare-profile.js --check
env -i PATH=/usr/bin:/bin \
  HERMES_HOME=/Users/ekytec/.local/share/ekybot-v2/hermes/profiles/ekybot-v2-pilot \
  /Users/ekytec/.openclaw/hermes-agent/.venv/bin/python -I -B \
  scripts/hermes-profile-isolation-probe.py \
  --runtime /Users/ekytec/.openclaw/hermes-agent \
  --home /Users/ekytec/.local/share/ekybot-v2/hermes/profiles/ekybot-v2-pilot \
  --root /Users/ekytec/.local/share/ekybot-v2/hermes
node scripts/hermes-prepare-profile.js --check
```

Le résultat attendu est `status: passed`, avec `soulLoaderTested`, `nativeBootstrapTested` et `fullRuntimeActivationQualified` à `false`. Un résultat différent suspend cette recette ; ne pas élargir automatiquement les permissions pour la terminer.

## Journal du pilote et qualification de l’authentification

`src/hermes-pilot-journal.js` ajoute un chemin V2 dédié, sans branchement sur le daemon actif. Il associe la première session retournée au canal exact, puis exige sa continuité. L’intention précède l’exécution ; la réponse vérifiée est conservée dans une outbox avant publication. Une perte d’accusé de livraison ne relance pas le modèle. Le stockage privé et les écritures synchronisées sont partagés avec le garde de reprise existant.

Dix tests supplémentaires passent avec un exécuteur fictif : création/reprise, conflit de contenu, concurrence, arrêt réel du processus pendant la première création, publication rejouable et révocation d’association. Ce module ne lance pas encore Hermes : le lanceur natif et le service machine restent à intégrer.

`scripts/hermes-pilot-auth.py` qualifie uniquement l’import natif du module d’authentification, hors ligne et depuis l’export propre du runtime audité. Après autorisation du propriétaire, le diagnostic sur profil jetable a identifié la cause du précédent arrêt : l’import charge la configuration des fournisseurs/plugins, qui appelle `ensure_hermes_home()`. Le premier `os.mkdir` vise le dossier du profil déjà présent, pas l’ancien environnement. La variable d’encodage ajoutée par macOS est également admise dans l’environnement minimal.

La recette native passe désormais avec `--bootstrap-fixture` : seuls `audio_cache`, `hooks`, `image_cache`, `logs/curator` et `pairing` sont ajoutés au profil jetable, en permissions privées. Les fichiers existants, leurs empreintes et leurs permissions restent inchangés ; les mémoires restent vides. Le diagnostic et celui des lecteurs partagent une seule politique de dossiers autorisés dans `scripts/hermes_bootstrap_policy.py`. Toute écriture de fichier, tout accès réseau ou sous-processus reste bloqué ; ce contrôle Python est un détecteur, pas une sandbox OS.

Quatorze tests vérifient notamment les refus d’écriture d’identifiants/session, de dossier hors liste, de permissions élargies, de lecture d’anciens secrets et d’environnement contenant une clé API. `--login` est toujours refusé : cette recette hors ligne ne teste ni la connexion fournisseur ni le chat réel, et ne crée aucun identifiant. Le mode d’enrôlement explicite décrit ci-dessous est distinct.

Commande utilisée sur le profil jetable neuf, préparé séparément par le provisionneur :

```sh
env -i PATH=/usr/bin:/bin \
  HERMES_HOME=/private/tmp/ekybot-hermes-auth.hMIXoV/hermes/profiles/ekybot-v2-pilot \
  /Users/ekytec/.openclaw/hermes-agent/.venv/bin/python -I -B -S \
  scripts/hermes-pilot-auth.py \
  --runtime /private/tmp/ekybot-hermes-bootstrap.zgc4On/runtime \
  --profile-home /private/tmp/ekybot-hermes-auth.hMIXoV/hermes/profiles/ekybot-v2-pilot \
  --site-packages /Users/ekytec/.openclaw/hermes-agent/.venv/lib/python3.11/site-packages \
  --bootstrap-fixture /private/tmp/ekybot-hermes-auth.hMIXoV \
  --trace-blocked
```

Résultat observé : `native-auth-import-passed`, `existingProfileFilesUnchanged: true`, `providerAuthenticationTested: false`, `loginEnabled: false`, `modelInvoked: false`. Les chemins temporaires ci-dessus documentent cette exécution ; pour la reproduire, préparer un nouveau profil jetable privé, sans réutiliser le profil réel ni élargir la liste des dossiers autorisés.

Avant enrôlement, le profil réel passait `hermes-prepare-profile.js --check` : fichiers inchangés, mémoires vides, aucune session ni authentification créée. Ce contrôle du profil strictement vierge n’est plus le contrôle adapté après l’ajout des dossiers natifs ou des identifiants ; ne pas effacer ces éléments pour le faire repasser.

## Connexion Claude API

Le propriétaire a remplacé la tentative OpenAI par **Claude Opus 5.5 via API uniquement**. Le flux ChatGPT est annulé : aucun `auth.json` ni session n’a été créé. `src/hermes-pilot-routing.js` sélectionne `anthropic / claude-opus-5-5`, avec effort standard `medium` et aucun fallback. Cette configuration est appliquée au profil réel avec `scripts/hermes-pilot-configure.js --configure`. Les outils restent désactivés et le marqueur d’exécution reste bloquant.

Le modèle est confirmé par la page officielle [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview). Il utilise la facturation API Anthropic. Sa disponibilité effective sur le compte reste à vérifier avec la nouvelle clé.

La recherche autorisée de clé a porté sur les fichiers `.env` et l’authentification des emplacements Hermes concernés, pas sur les mémoires. Aucune clé API Anthropic n’y est configurée. Le propriétaire a choisi de saisir une nouvelle clé localement ; aucune recherche dans OpenClaw n’est autorisée ni effectuée.

`scripts/hermes-pilot-key-setup.js` ouvre un formulaire à usage unique sur `127.0.0.1`, avec champ masqué, expiration à dix minutes, jeton anti-CSRF et contrôle de l’origine/du Host. Aucun asset distant, journal de requête ni script navigateur. La clé est stockée uniquement dans `.ekybot-anthropic-key.json` (`0600`) à l’intérieur du profil privé ; ni le `.env` initial, ni la mémoire, ni les autres secrets ne sont importés. Un secret différent déjà présent n’est jamais écrasé. La page attend la saisie du propriétaire. L’enregistrement ne constitue pas une validation d’accès API ni une activation du chat.

Six tests de configuration et quatre tests HTTP locaux complètent les tests de routage et d’enrôlement. Ils vérifient la persistance privée, l’absence de reprise des autres secrets, les refus d’origine/nonce et de jetons OAuth, et le maintien des mémoires vides. Aucun appel modèle ni première session n’a encore été lancé. Le flux OpenAI reste disponible dans le code mais n’est pas une dépendance du pilote actuel ; ne pas le relancer sans nouvelle demande.

La recette dans le navigateur intégré a reproduit puis corrigé le refus d’origine : `Referrer-Policy: no-referrer` produisait `Origin: null` lors du POST natif. La politique `same-origin` conserve l’origine pour le formulaire local sans transmettre de référent à un autre site. Les origines nulles, manquantes et étrangères restent refusées. Deux envois fictifs ont ensuite abouti, dont une clé au format personnel `sk-ant-usr-…`, sans écriture de credential ni appel fournisseur. Le contrôle de syntaxe accepte les familles `sk-ant-` sans imposer l’ancien préfixe `sk-ant-api` ; OAuth, refresh tokens et clés administratives restent exclus. Une syntaxe reconnue n’est pas une preuve d’authentification. Les erreurs réaffichent le formulaire vide et une aide statique, sans refléter le secret. La clé réelle doit être ressaisie après ces correctifs, puis vérifiée auprès de l’API.

## Première session et activation à terminer

### Connexion OpenAI prioritaire et qualification native

La nouvelle clé a été enregistrée localement. Le propriétaire a fourni son workspace Anthropic ; il est conservé dans le même fichier privé, sans copier l’ancien environnement. `scripts/hermes-pilot-api-check.js --workspace wrkspc_…` sélectionne explicitement le workspace avant toute session, puis vérifie seulement les métadonnées du modèle. Le contrôle réel retourne **HTTP 200**, `model-metadata-verified`, pour `claude-opus-5-5`. Aucun appel Messages ni token de génération consommé. Une erreur fournisseur est classée sans exposer son corps ou les credentials ; trois nouveaux tests couvrent la sélection, les en-têtes via stdin et les refus.

Le propriétaire a autorisé une courte recette réelle avec « go 1 à 4 », puis demandé de remettre **OpenAI GPT‑5.6 par abonnement en priorité, Claude Opus 5.5 via API en secours**. La [documentation officielle](https://developers.openai.com/api/docs/models/gpt-5.6-sol) indique que l’alias `gpt-5.6` correspond à `gpt-5.6-sol` ; le pilote utilise ce nom canonique, sans migration vers GPT‑6. Le nom commercial « Max » et l’éligibilité exacte du compte ne sont pas déduits d’un réglage local. La [connexion ChatGPT](https://learn.chatgpt.com/docs/auth) est distincte d’une clé API facturée à l’usage.

L’enrôlement indépendant du nouveau profil est relancé par device code. Il ne copie ni les identifiants globaux Codex ni l’ancien Hermes. `hermes-pilot-openai-check.js` vérifie ensuite le catalogue authentifié du compte avec un GET borné ; un modèle annoncé n’est pas une preuve d’inférence réussie. Aucun code temporaire ou jeton n’est enregistré dans le dépôt.

Après enrôlement, `hermes-pilot-configure.js --openai-primary` prépare le profil inactif et une politique privée OpenAI → Claude. Cette transition refuse un historique existant, un credential OpenAI absent et un secours Anthropic sans workspace. Elle préserve la clé Anthropic, la mémoire vide et l’interdiction d’exécution. Le fallback natif large reste désactivé : `hermes-pilot-fallback.js` n’autorise qu’un seul secours après un refus fournisseur attesté avant exécution (401/403/429/404 correspondants). Timeout, sortie partielle, outil exécuté et résultat incertain restent bloquants. Ce module doit encore être raccordé au dispatcher durable.

`scripts/hermes-pilot-native-probe.py` est une **recette hors ligne uniquement**, qui refuse les vraies exécutions et n’accepte qu’une credential fictive fixe. Elle exerce `AIAgent` + `SessionDB` sans démarrage interactif du CLI : zéro outil, aucun fallback/compression/titre automatique et un seul appel simulé par tour. La compatibilité des clés personnelles Anthropic et de l’en-tête workspace est préparée uniquement dans ce processus. Le contrôle Python est une défense de diagnostic, pas une sandbox OS.

Après autorisation de reprendre le diagnostic, l’exception générique `Connection error` est isolée : le faux transport renvoyait du JSON à une requête de streaming, puis le runtime tentait des appels supplémentaires que le garde refusait. La fixture renvoie maintenant les événements SSE attendus. **La recette native passe sur deux tours**, avec même identifiant de session, progression de la base et historique transmis plus long au second tour ; la mémoire initiale reste vide. Aucun garde n’a été désactivé, aucun réseau réel utilisé. La réponse étant fictive, cette recette ne valide pas le raisonnement ou la réponse d’un fournisseur réel.

Suite : terminer la confirmation utilisateur OpenAI, contrôler son catalogue, appliquer la préférence inactive, puis qualifier le transport OpenAI et le raccordement au journal avant la courte recette réelle approuvée. Aucun worker, canal ni déploiement Vercel n’est encore activé.

La recette native exige les chemins explicites `EKYBOT_NATIVE_RUNTIME`, `EKYBOT_NATIVE_PACKAGES` et `EKYBOT_PROBE_PYTHON`. Sans ces paramètres, son test est ignoré ; il doit être exécuté explicitement avant une livraison. Les tests de routage, configuration et catalogue utilisent uniquement des données fictives.

Recette complète exécutée avec ces trois paramètres : **179 tests réussis, aucun ignoré ni échoué**. Le lint ciblé et le contrôle du diff passent.

1. Conserver le profil réel vide et bloqué. L’initialisation native sur profil jetable est qualifiée, mais ne constitue pas une autorisation de lancer le CLI de chat. Qualifier son authentification et la capture explicite de l’identifiant de session.
2. Définir de nouvelles instructions et les outils autorisés. Vérifier aussi la mémoire globale, les fichiers de contexte des dossiers parents et les variables d’environnement : un nouveau nom de profil ne prouve pas à lui seul l’isolation.
3. Créer la première session avec une demande stable, puis enregistrer durablement l’identifiant natif retourné, le profil et le nouveau canal. Ne jamais déduire cet identifiant d’un titre, d’un préfixe ou de la session la plus récente.
4. Si cette création s’interrompt avec un résultat incertain, suspendre et réconcilier ; ne pas lancer automatiquement une deuxième création.
5. Activer ensuite le contrôle de continuité ci-dessous pour les messages suivants. Partir de zéro une fois ne signifie pas repartir de zéro à chaque message.

Les tests hors modèle précèdent tout essai réel. Un échange consommant des tokens doit être explicitement approuvé ; le profil réel est préparé mais aucune session native ni requête modèle n’a été créée pendant cette recette.

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
EKYBOT_HERMES_HOME_ROOT=/Users/ekytec/.local/share/ekybot-v2/hermes
EKYBOT_HERMES_REQUIRE_RESUME=1
EKYBOT_HERMES_RESUME_BINDINGS_PATH=/chemin/prive/bindings.json
EKYBOT_HERMES_RESUME_STATE_DIR=/chemin/prive/hermes-resume
EKYBOT_HERMES_TRANSPORT=cli
```

Cette configuration est une cible, pas une commande d’activation utilisable immédiatement : dans cet incrément, `EKYBOT_HERMES_HOME_ROOT` est compris par les lecteurs de métadonnées mais le client CLI refuse encore toute exécution sur une racine personnalisée. Le futur lanceur devra garantir le bon dossier de travail, un environnement maîtrisé, l’absence de `.env` hérité et une sélection explicite du modèle/authentification.

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

Au 21 octobre 2026 : **169 tests Node passent**, dont les validations SQLite sur bases fictives, les arguments CLI avec processus simulé, le rejeu après recréation de l’adaptateur, la concurrence de deux gardes, la mort d’un vrai sous-processus Node pendant une exécution fictive, les protections du provisionnement, les dix tests du journal V2, les 20 tests du diagnostic des lecteurs/bootstrap, les 20 tests du diagnostic d’authentification/enrôlement, quatre tests de routage, six de configuration et quatre HTTP locaux. Les tests Python nécessitent Python 3 (`EKYBOT_PROBE_PYTHON` permet de choisir l’interpréteur) et utilisent des modules Hermes fictifs. Les tests HTTP ont besoin d’un port loopback temporaire ; aucune clé réelle n’y est utilisée. Aucun runtime Hermes ni modèle n’est appelé par cette suite. Le lint ciblé passe également. Les recettes natives des lecteurs, du bootstrap jetable et de l’import d’authentification passent séparément, avec les limites précisées plus haut.

Le connecteur actif, l’ancienne base, les secrets et les conversations n’ont pas été reconfigurés. Le profil vide et ses lecteurs sont vérifiés ; l’initialisation complète, la première session et la livraison de bout en bout restent les prochains critères du pilote. La récupération de l’ancien chat est abandonnée.
