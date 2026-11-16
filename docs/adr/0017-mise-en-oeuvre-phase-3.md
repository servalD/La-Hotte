# ADR 0017 — Événements : accès, surprise et reprise

**Statut :** accepté · 2026-11-16 · précise l'ADR 0004 et l'ADR 0016

## Contexte

La phase 3 ajoute les événements (`05`). Trois choix sont coûteux à défaire : où se décide l'accès à un événement, comment on garde les honorés d'une surprise, et ce que veut dire « reprendre » un souhait (EVT-21). Une partie des règles dépend en outre de modules qui n'existent pas encore (notifications en phase 4, compta en phase 5).

## Décision

1. **L'accès à un événement est décidé par `visibility`** (VIS-36), par des fonctions pures sur les faits de l'événement, comme pour une liste. Le module `events` lit et écrit ; il ne décide d'aucun accès. L'audience `EVENT` d'une liste devient un fait de la liste (participants qui ont répondu `Participe` ou `Peut-être`), lu par le dépôt des listes et jugé par le moteur.
2. **Les honorés d'une surprise ont leur propre table** (`event_surprise_recipient`), jamais `event_participant`. Toute lecture faite pour un profil part de ses lignes de participant : la requête d'un honoré ne touche jamais les données de la surprise, ce qui ferme aussi la voie des différences de temps de réponse (GFT-07). Des déclencheurs croisés, avec verrou de la ligne `event`, garantissent qu'un honoré n'est jamais participant.
3. **Reprendre, c'est copier en gardant le lien** (`carried_from_item_id`, unique), pas déplacer la ligne. L'ancien élément garde son état et ses engagements, et donc la compta de l'ancien événement ; le nouveau part neutre, avec un fil des offreurs vide (EVT-21). La mention offreur de EVT-26 est calculée à la lecture depuis l'origine.
4. **Le lien d'invitation réutilise la table `invitation`** (type `EVENT`), sa consommation conditionnelle et son jeton haché (LNK-01). Il inscrit le profil actif seul.
5. **Ports vides.** Les notifications (`EventNotifier`) et les engagements (`EngagementReader`, déjà là pour VIS-16) sont des ports dont l'adaptateur ne fait rien, ou ne connaît rien, jusqu'aux phases 4 et 5. Seul l'e-mail d'invitation part, neutre (EVT-15).
6. **Date en jour et fuseau.** `event.date` est un jour sans heure, et `event.timezone` le fuseau du créateur (EVT-05). « Après la date », l'expiration d'un lien et le passage à `DONE` se calculent dans ce fuseau, par une fonction du domaine qui reçoit l'heure du port `Clock`.

## Raisons

- Un seul juge (invariant 2) : si `events` décidait de l'accès, une seconde règle existerait, et la matrice ne la couvrirait pas.
- Une colonne `is_secret_honoree` dans `event_participant` aurait obligé chaque requête de participant à l'exclure : un oubli suffit à révéler la surprise. Une table à part ne peut pas être lue par accident depuis une requête de participant.
- Déplacer la ligne aurait emporté les engagements dans un événement où leurs auteurs ne sont peut-être pas, et laissé quelqu'un engagé sur un élément qu'il ne voit plus (VIS-16).
- Inscrire tous les profils d'un compte par un seul geste aurait contourné le PIN des profils non actifs.

## Conséquences

- La matrice générée (VIS-33) gagne les dimensions des événements ; `security-reviewer` relit les fonctions d'accès aux événements comme le reste du moteur.
- La recherche des listes candidates (VIS-31) lit aussi les listes rattachées aux événements où le profil a répondu `Participe` ou `Peut-être`.
- Les phases 4 et 5 branchent leurs adaptateurs sur les ports, sans toucher aux cas d'usage de la phase 3.

## Alternatives écartées

Accès décidé dans le module `events` (deux juges) ; honorés de surprise marqués dans `event_participant` (une requête oublieuse révèle tout) ; reprise par déplacement de la ligne (engagements orphelins, compta de l'ancien événement modifiée) ; date avec heure en UTC (un événement du 24 décembre basculerait au 23 pour un fuseau à l'ouest).
