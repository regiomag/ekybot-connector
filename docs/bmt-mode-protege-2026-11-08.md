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
