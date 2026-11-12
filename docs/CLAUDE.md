# docs — spec, ADR, roadmap

La spec est la référence du produit. Le code s'y conforme ; quand ils divergent, on corrige l'un ou l'autre dans le même changement, jamais on ne laisse l'écart.

## Modifier la spec

- Une règle a un identifiant stable (`VIS-20`). On ne renumérote pas. Une règle supprimée garde son numéro avec la mention « retirée » et la raison.
- Une nouvelle règle prend le numéro libre suivant de son préfixe.
- Chaque fichier garde ses sections : objectif, règles, valeurs par défaut, critères d'acceptation, questions ouvertes.
- Une décision prise sort des « Questions ouvertes » et devient une règle. Mettre à jour aussi `99-tracabilite.md`.
- Vocabulaire : celui de `00-vision-glossaire.md`, sans exception. « Compte » et « profil » ne sont pas interchangeables.
- Après toute modification de `03`, `05`, `06` ou `07`, revérifier la matrice de `04-visibilite-repertoire.md` : la nouvelle règle crée-t-elle un chemin par lequel un destinataire apprendrait quelque chose ?

## ADR

- Un fichier par décision, numéroté, jamais réécrit. Une décision remplacée passe au statut « remplacé par 00NN » et le nouvel ADR explique pourquoi.
- Forme : contexte, décision, raisons, conséquences, alternatives écartées.
- Un ADR est justifié quand le choix est coûteux à défaire ou qu'un lecteur futur se demanderait « pourquoi pas autrement ? ».

## Roadmap

`roadmap.md` porte l'ordre des phases et l'étiquette de modèle de chaque tâche. La tenir à jour à la fin de chaque phase.

## Style

Français, phrases complètes, pas de jargon inutile. Tableaux pour les faits énumérables, prose pour le raisonnement.

## Modèle

Opus 5.5 (agent `spec-writer`) : une incohérence dans la spec coûte plus cher que les crédits économisés.
