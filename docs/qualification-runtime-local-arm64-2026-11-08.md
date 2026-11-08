# Qualification locale du runtime protégé — 8 novembre 2026

Cette preuve concerne une image de test sur une machine ARM64 et des données
fictives. Elle ne qualifie pas encore une image distribuée ni le parcours de
production. Les registres et les portes d'activation restent fermés.

## Image et environnement

- VM locale dédiée, un CPU et 1 Gio de mémoire, sans montage des fichiers du
  poste ni agent SSH ; son contexte Docker n'a pas remplacé le contexte courant.
- Image de base Node 24.9.0 Alpine :
  `sha256:b0d33ed19a912e1a18ceb83e139815233cd49c123fe025e67a7c506c93e3f728`.
- Contexte minimal construit sans réseau ; empreintes SHA-256 du Dockerfile,
  du travailleur et du contrat respectivement :
  `059ce2663221bbe34650c63a63635b91dea6702d5f9546c940fdc7323d21ea61`,
  `654c54411d633e9fa68328b2fb9eedd10bbdca6c8b39673f4b9aacfea8735c99` et
  `20654484bf774bb44c1ec0d7f64a6c83015bb01f55d8111c27b2e673f56b83ba`.
- Empreinte locale de l'image produite :
  `sha256:17e1c134864be3fccd72a3b1928d43a10b5d88bd0d1659600b6998fc93b671f2`.
  Elle est une preuve locale, pas une image publiée ou réputée reproductible.
- Une archive locale de cette image a été conservée pour reproduire les essais ;
  son SHA-256 est `d9a6614f6610a747ea281c516f834ac0f740d54f753098e8e4af6bca3dda6239`.
  Une copie locale seule ne constitue pas un canal de distribution qualifié.

## Résultats observés

- Le vrai conteneur échange avec un faux modèle HTTP situé sur le poste, via le
  seul pont du compagnon. Une question structurée fictive a donné une réponse ;
  les droits ont été recontrôlés et le journal de reprise a été nettoyé.
- Dans le conteneur : utilisateur non privilégié, PID 1 dans son espace privé,
  seule interface réseau `lo`, racine en lecture seule, aucun socket Docker ni
  marqueur fictif de l'environnement du poste. L'inspection a confirmé les
  restrictions réseau, privilèges et montages prévues.
- Après arrêt brutal du superviseur, la reprise a retrouvé et arrêté le
  conteneur, puis effacé le journal correspondant.
- Un essai synthétique distinct a relié le vrai conteneur, le faux modèle, la
  base PostgreSQL Ekybot éphémère, la réservation et l'estimation des coûts. Le
  service de contrôle BMT était simulé ; ses fonctions SQL ont été vérifiées
  séparément sur une base éphémère.
- Un banc ultérieur a relié les fonctions et migrations des deux services sur
  deux bases éphémères, la projection BMT, l'envoi signé, le conteneur, le
  modèle fictif puis Qwen 2.5 7B sur Ollama local, et le retour chiffré. Les
  jetons ont été mesurés et un montant de test a été comptabilisé. Des marqueurs
  sensibles fictifs étaient absents de l'envoi et de la requête au modèle ; une
  révocation a bloqué la lecture. La source métier et le transport entre les
  services étaient simulés. L'instance Ollama locale avait son cloud désactivé.

## Construction reproductible sur cette machine

Deux constructions séparées, sans cache et depuis des contextes différents,
ont produit la même archive OCI et la même configuration :

- base ARM64 `node@sha256:b0d33ed19a912e1a18ceb83e139815233cd49c123fe025e67a7c506c93e3f728` ;
- Docker 29.5.2, BuildKit 0.30.0 et Buildx 0.38.2 ;
- `SOURCE_DATE_EPOCH=0`, étapes de construction sans réseau et export OCI
  `rewrite-timestamp=true` ; la résolution de la base peut contacter un registre ;
- configuration OCI `sha256:3643c9a8e7f507590fe95f2458c976442cf1457d49541becd60c8782476a3d5d` ;
- manifeste OCI `sha256:2891a3443455b2caea65ea5d5ce5382980eb40f1ef90c4dfc55c271146a6dc68` ;
- archive SHA-256 `8a2c5194004447c29b60ef83a1b8185cb3c14e36a449754ceda5ba218b847f7a`.

L'archive a été chargée dans la VM dédiée et le banc inter-dépôts a de nouveau
réussi jusqu'au retour avec le modèle Qwen local. Le script manuel
`scripts/construire-runtime-reproductible.js` vérifie la configuration et
l'archive avant de produire son fichier, sans remplacer un fichier existant.
Il prend quatre arguments absolus : Docker, socket Docker local, binaire Buildx
et destination. Une base déjà présente est nécessaire. Une autre version ou
plateforme peut produire d'autres empreintes et sera refusée. Cette preuve ne
remplace ni un canal de distribution, ni la qualification d'autres machines.

## À achever avant ouverture

- Distribuer une image de release vérifiable sur les plateformes prises en
  charge ; répéter les essais sur chacune. La qualité des réponses du modèle
  et son comportement dans d'autres situations restent à évaluer.
- Terminer le respect des budgets entre toutes les voies concurrentes et la
  résolution des coûts incertains. Aucun budget configuré n'est contourné.
- Vérifier la chaîne avec le vrai backend BMT et les migrations coordonnées,
  puis organiser la recette humaine. Aucun déploiement ni activation n'a été
  effectué par ces essais.
