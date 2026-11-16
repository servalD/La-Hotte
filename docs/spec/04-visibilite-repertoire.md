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
- **VIS-03** Les membres d'une liste sont toujours dans son audience, et les destinataires d'une wishlist aussi. `CERCLE` = les cercles réunis des destinataires (LNK-09, blocages exclus) ; `ÉVÉNEMENT` = les membres seuls tant que les événements n'existent pas (phase 3) ; sélection explicite = les membres et les profils choisis. Un destinataire de giftlist n'est jamais dans l'audience, même choisi (VIS-21).

### Niveau 2 — Règle de l'élément

- **VIS-10** Un seul champ, trois valeurs :

| Valeur                | Sens                         | Usage                            |
| --------------------- | ---------------------------- | -------------------------------- |
| `TOUS`                | Toute l'audience de la liste | Défaut                           |
| `SEULEMENT` + profils | Liste blanche                | « Seulement mamie et tonton »    |
| `TOUS SAUF` + profils | Liste noire                  | « Tout le monde sauf mon frère » |

- **VIS-11** Un élément dont la règle n'est pas `TOUS` est dit **caché** et porte un pictogramme visible de ceux qui peuvent le voir.
- **VIS-12** La règle ne peut que restreindre l'audience de la liste, jamais l'élargir. Un profil en liste blanche qui n'est pas dans l'audience ne voit pas l'élément ; l'interface le signale au moment de la saisie et propose d'ajouter ce profil à l'audience.
- **VIS-13** L'interface de sélection est une liste déroulante à choix multiples des profils de l'audience, avec un interrupteur « Seulement eux / Tous sauf eux ». Passer de l'un à l'autre conserve la sélection.
- **VIS-14** Qui peut modifier la règle : voir LST-03. Chaque modification est tracée (qui, quand, ancienne et nouvelle valeur), consultable par le créateur.
- **VIS-15** Un nouveau profil rejoignant l'audience voit les éléments en `TOUS` et `TOUS SAUF`, pas ceux en `SEULEMENT`. C'est la différence pratique entre les deux modes, expliquée dans l'interface en une ligne.
- **VIS-16** Retirer la visibilité à un profil qui avait réservé ou participé : l'action est bloquée tant que sa réservation existe, avec proposition de le prévenir. On ne laisse pas quelqu'un engagé sur un élément qu'il ne voit plus.
- **VIS-17** Sur une wishlist partagée, la règle d'un souhait s'applique aussi aux co-destinataires qui ne l'ont pas ajouté ; celui qui l'a ajouté le voit toujours.
- **VIS-18** Quand le créateur étend le droit de LST-03 au contributeur, celui-ci ne modifie que la règle de ses propres éléments.
- **VIS-19** Les profils d'une règle se choisissent parmi le cercle de celui qui la modifie et les membres de la liste ; tout autre profil est refusé (`422 VISIBILITY_PROFILE_INVALID`). La règle et ses profils ne sont lus que par ceux qui peuvent la modifier. Le journal de VIS-14 ne porte pas les règles des suggestions, qui n'appartiennent qu'à leur auteur (WSH-07) : il est lu par l'autorité de la liste, qui peut en être destinataire ; une entrée n'est montrée que si ni la règle d'avant ni celle d'après n'écartent le lecteur (sauf s'il en est l'auteur), et, pour un élément supprimé, seulement si le lecteur n'en est pas destinataire ou si l'auteur du changement l'est aussi : le journal ne raconte pas l'activité des offreurs (VIS-20).

### Niveau 3 — Règle de surprise

- **VIS-20** Un destinataire ne voit **jamais**, sur un élément qui lui est destiné : les réservations, les participations et leurs montants, l'acheteur, l'état réel de l'élément (seul « reçu » lui est montré, LST-16), le fil des offreurs, les suggestions (WSH-04), l'historique d'activité des offreurs.
- **VIS-21** Cette règle s'applique quel que soit son rôle sur la liste, y compris créateur. Elle prime sur toutes les autres.
- **VIS-22** Elle s'applique aussi aux agrégats : compteurs, totaux, badges de notification, résultats de recherche, exports, et à tout ce que renvoie l'API, pas seulement à ce qu'affiche l'interface.

## Moteur de visibilité

- **VIS-30** Toute lecture passe par un service unique du domaine qui prend (profil actif, ressource) et renvoie la vue autorisée. Aucun contrôleur, aucune requête, aucun événement temps réel ne construit une réponse sans lui.
- **VIS-31** Le filtrage se fait dans la requête de base de données quand c'est possible, pas après chargement. Les champs interdits sont **absents** de la réponse, pas vides ni masqués.
- **VIS-32** Les événements temps réel sont émis par destinataire après passage dans le moteur (voir `06-commentaires-notifications.md`).
- **VIS-33** Le moteur est couvert par une matrice de tests générée : chaque combinaison (type de liste, rôle, appartenance au compte, règle d'élément, état, avant ou après la date de l'événement) a un résultat attendu écrit.
- **VIS-34** Une liste ou un élément qu'un profil ne voit pas répond `404`, comme un identifiant inconnu (SEC-04) ; une action interdite sur une liste ou un élément qu'il voit répond `403`.
- **VIS-35** La vue destinataire d'un souhait est une liste fermée de champs : identifiant, liste, fiche (titre, description, image, vendeur, URL d'origine), quantité, prix unitaire et devise, priorité, note, « plusieurs exemplaires bienvenus », caché ou non, reçu et sa date, ajouté par soi ou non, version (API-17). La version d'un élément ne change jamais pour une écriture d'offreur : réservations, parts et achat vivent dans leurs propres tables, et la date de modification n'est pas montrée. La position brute n'est pas montrée au destinataire : ses trous trahiraient les suggestions et les cadeaux non montrés ; l'ordre des éléments rendus suffit. Pour la même raison, la position qu'envoie un destinataire pour réordonner est un rang parmi les éléments qu'il voit : le serveur redistribue entre eux les places qu'ils occupent, sans toucher aux autres. Un changement de règle par un responsable fait bouger la version : c'est la gestion de la liste, déjà visible par la mention « caché », non un engagement. Tout autre champ exige de modifier cette règle et la liste blanche du test de contrat.

## Matrice de référence

| Qui regarde                                | Souhait `TOUS`                | Souhait caché, autorisé | Souhait caché, exclu | Réservations et parts | Fil des offreurs |
| ------------------------------------------ | ----------------------------- | ----------------------- | -------------------- | --------------------- | ---------------- |
| Destinataire                               | Oui                           | Oui                     | Oui (c'est le sien)  | **Non**               | **Non**          |
| Offreur dans l'audience                    | Oui                           | Oui                     | **Non**              | Oui                   | Oui              |
| Offreur du même compte que le destinataire | Oui                           | Oui                     | **Non**              | Oui                   | Oui              |
| Profil hors audience                       | Non                           | Non                     | Non                  | Non                   | Non              |
| Destinataire d'une giftlist cachée         | Rien, pas même l'existence    |                         |                      |                       |                  |
| Administrateur                             | Non (voir `11-admin-rbac.md`) | Non                     | Non                  | Non                   | Non              |

## Répertoire

- **REP-01** Le répertoire rassemble des **fiches article**, pas des éléments de liste. Y publier une fiche ne dit rien de la liste où elle figure, ni pour qui elle est.
- **REP-02** Niveau de partage d'une fiche : `PRIVÉ` (défaut), `CERCLE`, `CATALOGUE GLOBAL`.
- **REP-03** `CERCLE` : visible des profils du cercle, avec le nom de celui qui partage.
- **REP-04** `CATALOGUE GLOBAL` : visible de tous les comptes vérifiés, **sans auteur**, sans note personnelle, sans photo prise par l'utilisateur (seulement les images issues d'un lien marchand). Soumis à modération (voir `11-admin-rbac.md`). Interdit aux profils enfants.
- **REP-05** Depuis le répertoire, « ajouter à ma liste » crée une copie de la fiche (ART-04).
- **REP-06** **Publication d'un élément caché.** Si la fiche qu'on veut publier est référencée par un élément caché, une fenêtre de confirmation s'ouvre :

  > Cet article est caché à certaines personnes. Le publier pourrait leur donner une idée de ce que vous préparez.
  >
  > - **Le rendre visible de tous** et le publier dans le répertoire
  > - **Le partager seulement à certaines personnes** (ouvre le sélecteur VIS-13)
  > - Annuler

  Le premier choix repasse l'élément en `TOUS` et publie la fiche. Le second ne publie pas la fiche et modifie seulement la règle de l'élément.

- **REP-07** Une fiche publiée au cercle n'apparaît pas aux profils exclus par la règle d'un élément qui la référence. Le moteur de visibilité tranche au plus restrictif.
- **REP-08** Dépublier est immédiat. Les copies déjà faites par d'autres restent.
- **REP-09** Le catalogue global ouvre avec la modération (phase 7) : d'ici là, `PUT /products/{id}/share` refuse `GLOBAL` (`422 GLOBAL_CATALOG_UNAVAILABLE`).
- **REP-10** Une fiche publiée n'apparaît jamais, dans le répertoire ni dans la recherche, à un profil destinataire d'un élément qui la référence (cadeau d'une giftlist, suggestion sur sa wishlist) : la publication ne révèle pas ce qu'on lui prépare. Avec REP-07, le moteur écarte donc les exclus et les destinataires de tout élément qui référence la fiche. Pour qu'une fiche déjà publiée ne disparaisse pas du répertoire d'un destinataire (ce serait une trace, GFT-07), l'ajouter à une liste dont un autre profil est destinataire crée d'office une copie privée (ART-04), que l'élément référence ; de même, ajouter un destinataire à une liste fait passer sur une copie privée les éléments qui référencent une fiche publiée.

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
