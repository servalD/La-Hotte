# 11 — Rôles, permissions et administration

## Objectif

Définir qui a le droit de faire quoi, à l'échelle de la plateforme et à l'échelle de chaque ressource, et donner aux administrateurs les moyens d'exploiter le service sans pouvoir lire la vie privée des utilisateurs.

## Le RBAC est-il adapté ?

Oui pour les rôles de plateforme, non comme seul mécanisme. « Peut-il modérer le catalogue ? » dépend d'un rôle. « Peut-il voir ce souhait ? » dépend de la relation entre un profil et une ressource (membre de la liste, dans l'audience, destinataire, règle de l'élément). D'où deux étages :

1. **RBAC plateforme** : un rôle par compte.
2. **Politiques de ressource** : rôles par liste et par événement, plus le moteur de visibilité (`04-visibilite-repertoire.md`).

Une action est autorisée si les deux étages l'autorisent.

## Étage 1 — Rôles plateforme

| Rôle        | Porté par | Description                                                               |
| ----------- | --------- | ------------------------------------------------------------------------- |
| `USER`      | Compte    | Rôle par défaut. Toutes les fonctions du produit.                         |
| `MODERATOR` | Compte    | `USER` + modération du catalogue global et traitement des signalements.   |
| `ADMIN`     | Compte    | `MODERATOR` + gestion des comptes, des rôles, des réglages de plateforme. |

- **RBAC-01** Le rôle est porté par le **compte**, pas par le profil. Les actions d'administration se font hors de tout profil, dans un espace séparé (`/admin`), avec une session plus courte (AUTH-04) et TOTP obligatoire (AUTH-13).
- **RBAC-02** Permissions plateforme :

| Permission                                                                    | USER | MODERATOR | ADMIN |
| ----------------------------------------------------------------------------- | ---- | --------- | ----- |
| Utiliser le produit                                                           | ✔    | ✔         | ✔     |
| Voir la file de modération du catalogue                                       |      | ✔         | ✔     |
| Retirer une fiche du catalogue global                                         |      | ✔         | ✔     |
| Traiter un signalement                                                        |      | ✔         | ✔     |
| Suspendre la publication au catalogue pour un compte                          |      | ✔         | ✔     |
| Rechercher un compte par e-mail                                               |      |           | ✔     |
| Suspendre ou réactiver un compte                                              |      |           | ✔     |
| Forcer la déconnexion, réinitialiser le TOTP d'un compte (procédure vérifiée) |      |           | ✔     |
| Attribuer ou retirer un rôle                                                  |      |           | ✔     |
| Consulter le journal d'audit                                                  |      |           | ✔     |
| Modifier les réglages de plateforme (plafonds, inscriptions ouvertes)         |      |           | ✔     |
| Consulter les statistiques agrégées                                           |      | ✔         | ✔     |

- **RBAC-03** Attribuer `ADMIN` demande un administrateur existant et une ré-authentification. Le premier administrateur est créé par une commande d'exploitation, jamais par l'interface. Un administrateur ne peut pas retirer son propre rôle s'il est le dernier.
- **RBAC-04** Les permissions sont vérifiées par un garde déclaratif sur chaque route, avec refus par défaut.
- **RBAC-05** **Espace d'administration.** Les routes `/admin` ne lisent ni n'écrivent aucun profil : elles n'exigent pas de profil actif et ignorent `X-Expected-Profile`. Un compte `USER` reçoit `404` sur tout `/admin` (l'espace n'existe pas pour lui) ; un `MODERATOR` reçoit `404` sur les routes réservées à `ADMIN`, avec la même forme de réponse. La session d'un compte `ADMIN` ou `MODERATOR` suit AUTH-04 (12 heures glissantes). Le rôle est relu en base à chaque requête `/admin` (pas depuis le cache de session) : une attribution ou un retrait prend effet à la requête suivante.
- **RBAC-06** **Actions sensibles.** Elles exigent une ré-authentification récente (AUTH-14) et un motif saisi (10 à 500 caractères) : suspension et réactivation, attribution et retrait de rôle, réinitialisation du TOTP, déconnexion forcée, modification d'un réglage. Un administrateur n'agit jamais sur son propre compte par ces routes, sauf pour retirer son propre rôle (RBAC-03).
- **RBAC-07** **Attribution d'un rôle.** La cible doit avoir un TOTP actif (AUTH-13), une adresse vérifiée et ne pas être sous tutelle ; sinon `422 ROLE_REQUIREMENTS_NOT_MET`, sans détailler lequel. Le changement incrémente l'époque du compte (ADR 0014) : ses sessions repartent avec la durée de leur nouveau rôle.

## Étage 2 — Rôles de ressource

| Ressource | Rôles                                                        | Défini en      |
| --------- | ------------------------------------------------------------ | -------------- |
| Liste     | Créateur, Responsable, Contributeur, Lecteur                 | LST-02         |
| Événement | Organisateur, Participant, Invité                            | EVT-03, EVT-13 |
| Élément   | Destinataire, Offreur, Participant, Acheteur (rôles dérivés) | `03`, `07`     |
| Compte    | Tout profil non-enfant (gestion des profils)                 | `01`           |

- **RBAC-10** Ces rôles sont portés par des **profils**.
- **RBAC-11** Les politiques sont écrites une fois, dans le domaine, sous forme de règles (sujet, action, ressource, conditions), mises en œuvre avec CASL. Les contrôleurs ne contiennent aucune logique d'autorisation.
- **RBAC-12** La règle de surprise (VIS-20) est une interdiction qui prime sur toute autorisation.

## Ce qu'un administrateur ne peut pas faire

- **ADM-01** Lire le contenu d'une liste, d'un élément, d'un commentaire, d'une giftlist, d'une participation ou d'un budget qui n'est pas publié au catalogue global. Il n'existe **aucune route** d'administration qui renvoie ces contenus.
- **ADM-02** Se connecter à la place d'un utilisateur. Pas de fonction « voir en tant que ».
- **ADM-03** Voir le cercle d'un profil ni la composition d'un événement.
- **ADM-04** Pour l'assistance, l'administrateur voit des **métadonnées** : date de création, dernière connexion, nombre de profils, nombre de listes, état du TOTP (actif ou non), état de vérification de l'e-mail, historique de suspension.
- **ADM-05** Un contenu signalé est visible du modérateur **dans la limite de ce qui est signalé** (le commentaire ou la fiche en cause, avec le contexte minimal), parce qu'un utilisateur qui y avait accès l'a transmis. Un signalement venant d'un fil Offreurs ne montre pas à qui le cadeau est destiné.
- **ADM-06** **Suspension.** Un compte suspendu ne se connecte plus (réponse neutre, comme un mauvais mot de passe) et toutes ses sessions, pré-authentifications et appareils de confiance sont révoqués : l'époque du compte est incrémentée (ADR 0014), car la branche « en cache » de la résolution de session ne revérifie pas l'état. Son contenu n'est ni masqué ni supprimé. Le titulaire reçoit un e-mail sans motif détaillé. La réactivation n'efface rien.
- **ADM-07** **Réinitialisation du TOTP, procédure vérifiée.** L'administrateur ne voit ni ne choisit aucun secret : il déclenche l'envoi, à l'adresse vérifiée du compte, d'un lien à usage unique valable 30 minutes. L'ouverture du lien désactive le TOTP, révoque sessions, pré-authentifications et appareils de confiance, et envoie un avertissement. Pour un compte `ADMIN` ou `MODERATOR`, qui ne peut pas rester sans TOTP (AUTH-13), le déclenchement retire d'abord le rôle : le titulaire se reconnecte, active un nouveau TOTP, et un administrateur redonne le rôle (RBAC-07). Le dernier administrateur ne se réinitialise pas par l'interface (RBAC-03) : procédure d'exploitation.
- **ADM-08** **Déconnexion forcée** : révoque toutes les sessions du compte, rien d'autre.
- **ADM-09** **Réglages de plateforme.** Liste fermée, stockée en base (`platform_setting`) ; toute modification est journalisée avec l'ancienne et la nouvelle valeur. `registration_mode` (`OPEN` ou `INVITE_ONLY`) : la valeur en base prime sur `REGISTRATION_MODE`, qui n'est que la valeur initiale (AUTH-09). `forbidden_terms` et `blocked_domains` (MOD-09), 500 entrées au plus chacun. `extraction_daily_limit` (entier de 0 à 200, par profil). Toute autre clé est refusée.
- **ADM-10** **Recherche de compte** : par adresse exacte seulement, jamais de recherche partielle ni de liste de comptes ; 20 recherches par heure et par administrateur. Le résultat se limite à ADM-04. La recherche est journalisée (AUD-01) avec l'empreinte de l'adresse, pas l'adresse.

## Modération du catalogue global

- **MOD-01** Une fiche publiée au catalogue global est visible immédiatement si elle vient d'un lien marchand avec extraction réussie ; les fiches saisies à la main passent par la file de modération avant publication.
- **MOD-02** Contrôle automatique à la publication : liste de termes interdits, domaine marchand non bloqué, image analysée.
- **MOD-03** Tout utilisateur peut signaler une fiche ou un commentaire, avec un motif. Trois signalements distincts masquent la fiche en attendant un modérateur.
- **MOD-04** Décisions : garder, retirer, retirer et suspendre la publication du compte. L'auteur est notifié avec le motif et peut contester une fois.
- **MOD-05** Dédoublonnage du catalogue par URL normalisée : une même page n'apparaît qu'une fois, avec un compteur « ajouté par N personnes » (sans noms).
- **MOD-06** **Statut de modération d'une fiche** (`moderation_status`). `NONE` : jamais soumise. À la publication `GLOBAL` : `APPROVED` si la source est `LINK` avec extraction `DONE` et que le contrôle MOD-09 passe ; sinon `PENDING` (en file, invisible du catalogue). Les fiches `PHOTO` et `MANUAL` passent toujours par la file. Une fiche visible du catalogue est `APPROVED`. Une décision « retirer » la met à `REJECTED` et ramène son niveau de partage à `PRIVATE` ; l'auteur garde sa fiche, les copies déjà faites restent (REP-08). Une fiche `PENDING` ou `REJECTED` n'apparaît ni dans le catalogue ni dans la recherche d'un autre profil.
- **MOD-07** **Signalement.** `POST /reports` avec une cible (`PRODUCT` ou `COMMENT`), un motif en liste fermée (`SPAM`, `INAPPROPRIATE`, `PRIVACY`, `ILLEGAL`, `OTHER`) et une note facultative de 500 caractères. Le signaleur doit pouvoir lire la cible (moteur de visibilité) ; une cible illisible ou inconnue répond `404` (SEC-04). Un profil signale une cible une seule fois ; le même compte ne compte qu'une fois pour le seuil. Le signalement est lu par le seul signaleur et par la modération ; l'auteur de la cible ne sait jamais qui a signalé. Un profil enfant peut signaler, aux mêmes conditions.
- **MOD-08** **Masquage à trois.** Dès que trois comptes distincts ont signalé une même cible, elle est masquée : une fiche sort du catalogue (comme `PENDING`) ; un commentaire est remplacé, pour tous ses lecteurs sauf son auteur, par « message en cours de vérification », sans texte ni mentions. Le masquage ne change ni le fil, ni son compteur, ni ce que les destinataires savent de l'élément (VIS-20 : un fil Offreurs reste invisible de ses destinataires, masqué ou non). Il tombe à la décision « garder ».
- **MOD-09** **Contrôle automatique à la publication.** Termes interdits (`forbidden_terms`, comparaison sans accent ni casse, sur titre, description et marchand) et domaines bloqués (`blocked_domains`, sur le domaine de `source_url` et ses sous-domaines) : une fiche qui en contient passe en `PENDING`, jamais en refus immédiat. L'« image analysée » du contrôle se limite en v1 à ce que l'extraction a déjà fait (image issue d'un lien marchand, réencodée, sans métadonnées, EXT-11 et REP-04) : aucune classification d'image n'est ajoutée ; un modérateur voit l'image dans la file.
- **MOD-10** **File et décisions.** Le modérateur voit, pour une fiche en attente ou signalée, la fiche elle-même (titre, description, image, marchand, URL) et les motifs de signalement ; pour un commentaire signalé, le texte, le motif, le fil (`PUBLIC` ou `GIVERS`) et rien d'autre : ni titre d'élément, ni liste, ni destinataires, ni autres messages (ADM-05). Décisions (motif saisi, RBAC-06 sans la ré-authentification) : `KEEP`, `REMOVE`, `REMOVE_AND_SUSPEND`. Retirer un commentaire en efface le texte (COM-15). `REMOVE_AND_SUSPEND` pose `publication_suspended_at` sur le compte de l'auteur : `GLOBAL` lui répond `403 PUBLICATION_SUSPENDED` ; un modérateur ou un administrateur lève la suspension de publication.
- **MOD-11** **Notification et contestation.** L'auteur d'une fiche retirée ou d'un commentaire retiré reçoit une notification dans l'application et un e-mail neutres, avec le motif de la décision (pas l'identité du modérateur ni des signaleurs). Il peut contester une fois, dans les 14 jours, par un texte de 500 caractères au plus ; un autre modérateur que celui qui a décidé traite la contestation, et sa décision est définitive. Une décision « garder » n'ouvre aucune contestation.
- **MOD-12** **Catalogue.** `GET /directory?scope=global&q=` rend les fiches `APPROVED` seulement, sans auteur, sans note, sans photo de l'utilisateur, avec le compteur MOD-05 ; le compteur compte des comptes distincts. Une fiche du catalogue reste soumise à REP-10 : le moteur écarte les fiches référencées par un élément dont le profil est destinataire. Publier au catalogue est refusé aux profils enfants (`403 CHILD_PROFILE`) et aux comptes dont la publication est suspendue.

## Journal d'audit

- **AUD-01** Chaque action d'un modérateur ou d'un administrateur produit une entrée : qui, quand, quoi, sur quelle cible, motif saisi, adresse IP.
- **AUD-02** Le journal est en ajout seul, non modifiable depuis l'application, et sauvegardé séparément.
- **AUD-03** Un utilisateur voit dans ses réglages les actions d'administration effectuées sur son compte.
- **AUD-04** Consulter le journal est lui-même journalisé.
- **AUD-05** **Atomicité.** L'entrée d'audit s'écrit dans la même transaction que l'action : si l'écriture échoue, l'action est annulée. Une action qui ne passe pas par la base (envoi d'e-mail, révocation d'une session en cache) suit la transaction et s'exécute après elle ; en cas d'échec de cette suite, l'entrée reste et une seconde entrée « échec de la suite » est ajoutée.
- **AUD-06** **Contenu d'une entrée.** Action (liste fermée), compte acteur, cible (type et identifiant de compte ou de fiche, jamais un contenu), motif, adresse IP, instant, et pour un réglage l'ancienne et la nouvelle valeur. Aucune entrée ne contient de titre, de commentaire ni d'adresse e-mail en clair. Consultation : `GET /admin/audit`, filtrable par acteur, action et période, 50 entrées par page ; réservée à `ADMIN`.
- **AUD-07** **Côté utilisateur** (AUD-03). `GET /account/admin-actions` rend les entrées dont la cible est le compte de la session : action, date et motif de suspension ou de réinitialisation ; jamais l'acteur ni son adresse IP.

## Statistiques

- **STA-01** Tableau de bord d'administration : agrégats uniquement (comptes actifs, listes créées, taux de réussite de l'extraction, coût d'extraction, erreurs, temps de réponse). Aucun agrégat sur un groupe de moins de 10 comptes.

- **STA-02** **Contenu du tableau de bord.** Comptes actifs sur 30 jours, comptes créés, listes créées, fiches publiées au catalogue, signalements ouverts et délai médian de traitement, taux de réussite et coût de l'extraction, taux d'erreur et temps de réponse. Chaque agrégat porte sur au moins 10 comptes, sinon la valeur est `null` (pas zéro). Aucune ventilation par compte ni par profil.

## Critères d'acceptation

- Un test parcourt toutes les routes `/admin` avec un compte `USER` et un compte `MODERATOR` et vérifie le tableau RBAC-02.
- Aucune route d'administration ne renvoie le titre d'une liste privée ni le texte d'un commentaire non signalé (test de non-régression sur le schéma des réponses).
- Chaque action d'administration a une entrée de journal ; une action dont l'écriture au journal échoue est annulée.

## Questions ouvertes

1. Faut-il un rôle `SUPPORT` distinct (métadonnées de compte sans pouvoir de suspension) ? Inutile tant que l'équipe est petite.
2. ~~Inscriptions ouvertes ou sur invitation au lancement~~ Tranchée le 2026-11-17 : **ouvertes à tous** (`OPEN`), contre la recommandation de rodage sur invitation. L'interrupteur reste réglable par un administrateur (ADM-09) si un afflux le demande.
3. Classification automatique des images du catalogue (MOD-09) : hors v1 ; à rouvrir si les signalements montrent un besoin.
