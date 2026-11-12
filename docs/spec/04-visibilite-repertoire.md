# 04 — Visibilité et répertoire

## Objectif

Répondre de façon unique et vérifiable à la question « ce profil a-t-il le droit de voir ceci ? ». C'est la partie du produit où une erreur coûte le plus : une surprise révélée ne se rattrape pas.

## Modèle à trois niveaux

Un profil voit un élément si les **trois** conditions sont vraies :

1. **Audience de la liste** : il fait partie de ceux à qui la liste est montrée.
2. **Règle de l'élément** : la règle de visibilité de l'élément ne l'exclut pas.
3. **Règle de surprise** : ce qu'il demande à voir ne lui est pas interdit en tant que destinataire.

### Niveau 1 — Audience de la liste

- **VIS-01** Audience possible : `MEMBRES` (seulement les membres de la liste), `CERCLE` (cercle des destinataires), `ÉVÉNEMENT` (participants de l'événement de rattachement), ou une sélection explicite de profils.
- **VIS-02** Défauts : wishlist personnelle = `CERCLE` ; wishlist d'événement = `ÉVÉNEMENT` ; giftlist = `MEMBRES`.

### Niveau 2 — Règle de l'élément

- **VIS-10** Un seul champ, trois valeurs :

| Valeur | Sens | Usage |
|---|---|---|
| `TOUS` | Toute l'audience de la liste | Défaut |
| `SEULEMENT` + profils | Liste blanche | « Seulement mamie et tonton » |
| `TOUS SAUF` + profils | Liste noire | « Tout le monde sauf mon frère » |

- **VIS-11** Un élément dont la règle n'est pas `TOUS` est dit **caché** et porte un pictogramme visible de ceux qui peuvent le voir.
- **VIS-12** La règle ne peut que restreindre l'audience de la liste, jamais l'élargir. Un profil en liste blanche qui n'est pas dans l'audience ne voit pas l'élément ; l'interface le signale au moment de la saisie et propose d'ajouter ce profil à l'audience.
- **VIS-13** L'interface de sélection est une liste déroulante à choix multiples des profils de l'audience, avec un interrupteur « Seulement eux / Tous sauf eux ». Passer de l'un à l'autre conserve la sélection.
- **VIS-14** Qui peut modifier la règle : voir LST-03. Chaque modification est tracée (qui, quand, ancienne et nouvelle valeur), consultable par le créateur.
- **VIS-15** Un nouveau profil rejoignant l'audience voit les éléments en `TOUS` et `TOUS SAUF`, pas ceux en `SEULEMENT`. C'est la différence pratique entre les deux modes, expliquée dans l'interface en une ligne.
- **VIS-16** Retirer la visibilité à un profil qui avait réservé ou participé : l'action est bloquée tant que sa réservation existe, avec proposition de le prévenir. On ne laisse pas quelqu'un engagé sur un élément qu'il ne voit plus.

### Niveau 3 — Règle de surprise

- **VIS-20** Un destinataire ne voit **jamais**, sur un élément qui lui est destiné : les réservations, les participations et leurs montants, l'acheteur, l'état réel de l'élément (seul « reçu » lui est montré, LST-16), le fil des offreurs, les suggestions (WSH-04), l'historique d'activité des offreurs.
- **VIS-21** Cette règle s'applique quel que soit son rôle sur la liste, y compris créateur. Elle prime sur toutes les autres.
- **VIS-22** Elle s'applique aussi aux agrégats : compteurs, totaux, badges de notification, résultats de recherche, exports, et à tout ce que renvoie l'API, pas seulement à ce qu'affiche l'interface.

## Moteur de visibilité

- **VIS-30** Toute lecture passe par un service unique du domaine qui prend (profil actif, ressource) et renvoie la vue autorisée. Aucun contrôleur, aucune requête, aucun événement temps réel ne construit une réponse sans lui.
- **VIS-31** Le filtrage se fait dans la requête de base de données quand c'est possible, pas après chargement. Les champs interdits sont **absents** de la réponse, pas vides ni masqués.
- **VIS-32** Les événements temps réel sont émis par destinataire après passage dans le moteur (voir `06-commentaires-notifications.md`).
- **VIS-33** Le moteur est couvert par une matrice de tests générée : chaque combinaison (type de liste, rôle, appartenance au compte, règle d'élément, état, avant ou après la date de l'événement) a un résultat attendu écrit.

## Matrice de référence

| Qui regarde | Souhait `TOUS` | Souhait caché, autorisé | Souhait caché, exclu | Réservations et parts | Fil des offreurs |
|---|---|---|---|---|---|
| Destinataire | Oui | Oui | Oui (c'est le sien) | **Non** | **Non** |
| Offreur dans l'audience | Oui | Oui | **Non** | Oui | Oui |
| Offreur du même compte que le destinataire | Oui | Oui | **Non** | Oui | Oui |
| Profil hors audience | Non | Non | Non | Non | Non |
| Destinataire d'une giftlist cachée | Rien, pas même l'existence | | | | |
| Administrateur | Non (voir `11-admin-rbac.md`) | Non | Non | Non | Non |

## Répertoire

- **REP-01** Le répertoire rassemble des **fiches article**, pas des éléments de liste. Y publier une fiche ne dit rien de la liste où elle figure, ni pour qui elle est.
- **REP-02** Niveau de partage d'une fiche : `PRIVÉ` (défaut), `CERCLE`, `CATALOGUE GLOBAL`.
- **REP-03** `CERCLE` : visible des profils du cercle, avec le nom de celui qui partage.
- **REP-04** `CATALOGUE GLOBAL` : visible de tous les comptes vérifiés, **sans auteur**, sans note personnelle, sans photo prise par l'utilisateur (seulement les images issues d'un lien marchand). Soumis à modération (voir `11-admin-rbac.md`). Interdit aux profils enfants.
- **REP-05** Depuis le répertoire, « ajouter à ma liste » crée une copie de la fiche (ART-04).
- **REP-06** **Publication d'un élément caché.** Si la fiche qu'on veut publier est référencée par un élément caché, une fenêtre de confirmation s'ouvre :

  > Cet article est caché à certaines personnes. Le publier pourrait leur donner une idée de ce que vous préparez.
  > - **Le rendre visible de tous** et le publier dans le répertoire
  > - **Le partager seulement à certaines personnes** (ouvre le sélecteur VIS-13)
  > - Annuler

  Le premier choix repasse l'élément en `TOUS` et publie la fiche. Le second ne publie pas la fiche et modifie seulement la règle de l'élément.
- **REP-07** Une fiche publiée au cercle n'apparaît pas aux profils exclus par la règle d'un élément qui la référence. Le moteur de visibilité tranche au plus restrictif.
- **REP-08** Dépublier est immédiat. Les copies déjà faites par d'autres restent.

## Recherche

- **VIS-40** La recherche porte sur : mes listes, les listes dont je suis dans l'audience, le répertoire de mon cercle, le catalogue global. Les résultats passent par le moteur de visibilité ; l'index de recherche ne contient aucun champ soumis à la règle de surprise.

## Critères d'acceptation

- Chaque ligne de la matrice a un test automatisé d'API.
- Un profil ajouté à l'audience après coup voit les éléments `TOUS SAUF` et pas les `SEULEMENT`.
- La publication d'une fiche liée à un élément caché ne peut pas aboutir sans passer par la fenêtre REP-06, y compris en appelant l'API directement (le serveur exige le choix explicite).
- Aucune réponse d'API faite à un destinataire ne contient un champ de réservation, même à `null`.

## Questions ouvertes

1. Faut-il des **groupes nommés** (« grands-parents », « collègues ») réutilisables dans les règles ? Pratique dès qu'on dépasse dix proches. Proposé en `15-suggestions.md`.
2. Le catalogue global doit-il être ouvert dès la v1 ou attendre que la modération soit rodée ? La roadmap le place en dernière phase.
