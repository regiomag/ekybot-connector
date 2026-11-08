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

## À achever avant ouverture

- Construire et distribuer une image de release vérifiable sur les plateformes
  prises en charge ; répéter les essais sur chacune et qualifier un modèle réel.
- Terminer le respect des budgets entre toutes les voies concurrentes et la
  résolution des coûts incertains. Aucun budget configuré n'est contourné.
- Vérifier la chaîne avec le vrai backend BMT et les migrations coordonnées,
  puis organiser la recette humaine. Aucun déploiement ni activation n'a été
  effectué par ces essais.
