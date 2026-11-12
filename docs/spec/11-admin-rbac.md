# 11 — Rôles, permissions et administration

## Objectif

Définir qui a le droit de faire quoi, à l'échelle de la plateforme et à l'échelle de chaque ressource, et donner aux administrateurs les moyens d'exploiter le service sans pouvoir lire la vie privée des utilisateurs.

## Le RBAC est-il adapté ?

Oui pour les rôles de plateforme, non comme seul mécanisme. « Peut-il modérer le catalogue ? » dépend d'un rôle. « Peut-il voir ce souhait ? » dépend de la relation entre un profil et une ressource (membre de la liste, dans l'audience, destinataire, règle de l'élément). D'où deux étages :

1. **RBAC plateforme** : un rôle par compte.
2. **Politiques de ressource** : rôles par liste et par événement, plus le moteur de visibilité (`04-visibilite-repertoire.md`).

Une action est autorisée si les deux étages l'autorisent.

## Étage 1 — Rôles plateforme

| Rôle | Porté par | Description |
|---|---|---|
| `USER` | Compte | Rôle par défaut. Toutes les fonctions du produit. |
| `MODERATOR` | Compte | `USER` + modération du catalogue global et traitement des signalements. |
| `ADMIN` | Compte | `MODERATOR` + gestion des comptes, des rôles, des réglages de plateforme. |

- **RBAC-01** Le rôle est porté par le **compte**, pas par le profil. Les actions d'administration se font hors de tout profil, dans un espace séparé (`/admin`), avec une session plus courte (AUTH-04) et TOTP obligatoire (AUTH-13).
- **RBAC-02** Permissions plateforme :

| Permission | USER | MODERATOR | ADMIN |
|---|---|---|---|
| Utiliser le produit | ✔ | ✔ | ✔ |
| Voir la file de modération du catalogue | | ✔ | ✔ |
| Retirer une fiche du catalogue global | | ✔ | ✔ |
| Traiter un signalement | | ✔ | ✔ |
| Suspendre la publication au catalogue pour un compte | | ✔ | ✔ |
| Rechercher un compte par e-mail | | | ✔ |
| Suspendre ou réactiver un compte | | | ✔ |
| Forcer la déconnexion, réinitialiser le TOTP d'un compte (procédure vérifiée) | | | ✔ |
| Attribuer ou retirer un rôle | | | ✔ |
| Consulter le journal d'audit | | | ✔ |
| Modifier les réglages de plateforme (plafonds, inscriptions ouvertes) | | | ✔ |
| Consulter les statistiques agrégées | | ✔ | ✔ |

- **RBAC-03** Attribuer `ADMIN` demande un administrateur existant et une ré-authentification. Le premier administrateur est créé par une commande d'exploitation, jamais par l'interface. Un administrateur ne peut pas retirer son propre rôle s'il est le dernier.
- **RBAC-04** Les permissions sont vérifiées par un garde déclaratif sur chaque route, avec refus par défaut.

## Étage 2 — Rôles de ressource

| Ressource | Rôles | Défini en |
|---|---|---|
| Liste | Créateur, Responsable, Contributeur, Lecteur | LST-02 |
| Événement | Organisateur, Participant, Invité | EVT-03, EVT-13 |
| Élément | Destinataire, Offreur, Participant, Acheteur (rôles dérivés) | `03`, `07` |
| Compte | Tout profil non-enfant (gestion des profils) | `01` |

- **RBAC-10** Ces rôles sont portés par des **profils**.
- **RBAC-11** Les politiques sont écrites une fois, dans le domaine, sous forme de règles (sujet, action, ressource, conditions), mises en œuvre avec CASL. Les contrôleurs ne contiennent aucune logique d'autorisation.
- **RBAC-12** La règle de surprise (VIS-20) est une interdiction qui prime sur toute autorisation.

## Ce qu'un administrateur ne peut pas faire

- **ADM-01** Lire le contenu d'une liste, d'un élément, d'un commentaire, d'une giftlist, d'une participation ou d'un budget qui n'est pas publié au catalogue global. Il n'existe **aucune route** d'administration qui renvoie ces contenus.
- **ADM-02** Se connecter à la place d'un utilisateur. Pas de fonction « voir en tant que ».
- **ADM-03** Voir le cercle d'un profil ni la composition d'un événement.
- **ADM-04** Pour l'assistance, l'administrateur voit des **métadonnées** : date de création, dernière connexion, nombre de profils, nombre de listes, état du TOTP (actif ou non), état de vérification de l'e-mail, historique de suspension.
- **ADM-05** Un contenu signalé est visible du modérateur **dans la limite de ce qui est signalé** (le commentaire ou la fiche en cause, avec le contexte minimal), parce qu'un utilisateur qui y avait accès l'a transmis. Un signalement venant d'un fil Offreurs ne montre pas à qui le cadeau est destiné.

## Modération du catalogue global

- **MOD-01** Une fiche publiée au catalogue global est visible immédiatement si elle vient d'un lien marchand avec extraction réussie ; les fiches saisies à la main passent par la file de modération avant publication.
- **MOD-02** Contrôle automatique à la publication : liste de termes interdits, domaine marchand non bloqué, image analysée.
- **MOD-03** Tout utilisateur peut signaler une fiche ou un commentaire, avec un motif. Trois signalements distincts masquent la fiche en attendant un modérateur.
- **MOD-04** Décisions : garder, retirer, retirer et suspendre la publication du compte. L'auteur est notifié avec le motif et peut contester une fois.
- **MOD-05** Dédoublonnage du catalogue par URL normalisée : une même page n'apparaît qu'une fois, avec un compteur « ajouté par N personnes » (sans noms).

## Journal d'audit

- **AUD-01** Chaque action d'un modérateur ou d'un administrateur produit une entrée : qui, quand, quoi, sur quelle cible, motif saisi, adresse IP.
- **AUD-02** Le journal est en ajout seul, non modifiable depuis l'application, et sauvegardé séparément.
- **AUD-03** Un utilisateur voit dans ses réglages les actions d'administration effectuées sur son compte.
- **AUD-04** Consulter le journal est lui-même journalisé.

## Statistiques

- **STA-01** Tableau de bord d'administration : agrégats uniquement (comptes actifs, listes créées, taux de réussite de l'extraction, coût d'extraction, erreurs, temps de réponse). Aucun agrégat sur un groupe de moins de 10 comptes.

## Critères d'acceptation

- Un test parcourt toutes les routes `/admin` avec un compte `USER` et un compte `MODERATOR` et vérifie le tableau RBAC-02.
- Aucune route d'administration ne renvoie le titre d'une liste privée ni le texte d'un commentaire non signalé (test de non-régression sur le schéma des réponses).
- Chaque action d'administration a une entrée de journal ; une action dont l'écriture au journal échoue est annulée.

## Questions ouvertes

1. Faut-il un rôle `SUPPORT` distinct (métadonnées de compte sans pouvoir de suspension) ? Inutile tant que l'équipe est petite.
2. Inscriptions ouvertes à tous ou sur invitation au lancement ? Recommandé : sur invitation pendant la phase de rodage.
