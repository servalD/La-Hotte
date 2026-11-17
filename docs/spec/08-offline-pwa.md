# 08 — Hors ligne et application installable

## Objectif

L'application s'ouvre et reste utilisable sans réseau, s'installe comme une application, et ne garde jamais sur l'appareil une donnée qu'un autre profil pourrait lire.

## Principe retenu

**Cache local + file d'attente, serveur arbitre.** L'appareil garde une copie de ce qui a déjà été chargé et met en attente les actions faites hors ligne. À la reconnexion, le serveur les accepte ou les refuse. Il n'y a pas de base locale répliquée ni de fusion automatique de données (voir `docs/adr/0005-offline.md`).

## Lecture hors ligne

- **OFF-01** L'enveloppe de l'application (pages, scripts, styles, polices, icônes) est pré-mise en cache par le service worker : l'application s'ouvre sans réseau.
- **OFF-02** Les données consultées sont conservées dans une base locale (IndexedDB) : mes listes, les listes ouvertes récemment, les événements à venir, mon panier, mes comptes, mes notifications.
- **OFF-03** Les données des événements à venir dans les 30 jours sont préchargées en arrière-plan sur Wi-Fi, pour être disponibles en magasin.
- **OFF-04** Affichage « cache d'abord, puis mise à jour » : la donnée locale s'affiche tout de suite, la donnée fraîche la remplace. Un indicateur discret montre l'état : à jour, mise à jour en cours, hors ligne depuis telle heure.
- **OFF-05** Images mises en cache à la consultation, avec plafond de stockage et éviction des plus anciennes.
- **OFF-06** **Ce qui est conservé** (précise OFF-02). Seules les lectures d'une liste fermée sont écrites dans le cache du profil : listes et éléments, fiches, événements, fils de commentaires, panier, comptes, vue latérale, budgets, propositions de compensation, notifications. Jamais la session, l'authentification, l'espace Compte, le profil actif (`/profiles/me*`), le cercle, ni le justificatif d'achat (CPT-62). Une lecture qui répond `404` ou `403` retire la donnée conservée correspondante.
- **OFF-07** **Durée** (question ouverte 2 tranchée le 2026-11-17). Le cache d'un profil qui n'a pas été ouvert sur l'appareil depuis 30 jours est effacé à l'ouverture suivante de l'application ; une lecture conservée depuis plus de 30 jours n'est pas affichée.
- **OFF-08** **Images** (précise OFF-05). Les images sont des réponses d'API propres à un profil : elles vont dans le cache du profil (chiffré pour un profil à PIN), jamais dans un cache commun du navigateur, où un autre profil de l'appareil verrait l'image d'un cadeau. Plafond de 30 Mo par profil, les moins récemment affichées évincées d'abord.
- **OFF-09** **Préchargement** (précise OFF-03). Il ne part que si le navigateur ne signale ni économie de données ni réseau cellulaire, et se limite aux événements à venir sous 30 jours, à leurs listes et à leurs éléments, au plus une fois par heure.

## Écriture hors ligne

- **OFF-10** Actions possibles hors ligne, mises en file :

| Action                                              | Hors ligne   | Remarque                                   |
| --------------------------------------------------- | ------------ | ------------------------------------------ |
| Ajouter, modifier, retirer un élément de ma liste   | ✔            | Un lien collé est analysé à la reconnexion |
| Commenter                                           | ✔            | Affiché « en attente d'envoi »             |
| Réserver, participer                                | ✔ en attente | Affiché « à confirmer », voir OFF-13       |
| Cocher Acheté, marquer une part réglée              | ✔            | Cas d'usage : en magasin sans réseau       |
| Confirmer une réception                             | ✔            |                                            |
| Modifier une règle de visibilité                    | ✘            | Doit être effectif immédiatement           |
| Inviter, créer un lien, publier au répertoire       | ✘            |                                            |
| Tout ce qui touche au compte, au PIN, à la sécurité | ✘            |                                            |

- **OFF-11** Chaque action en file porte une clé d'idempotence, l'identifiant du profil qui l'a faite, et la version de la ressource qu'elle modifie.
- **OFF-12** À la reconnexion, la file est rejouée dans l'ordre. Le serveur répond pour chaque action : acceptée, refusée (droit perdu, ressource supprimée), ou en conflit (version dépassée).
- **OFF-13** **Réservations et participations** : tant que le serveur n'a pas confirmé, l'interface affiche « à confirmer » et ne compte pas la somme dans le budget comme acquise. En cas de refus (quelqu'un a complété entre-temps), une notification explique et propose le reste disponible.
- **OFF-14** **Conflit de modification** sur un élément (deux contributeurs d'une liste partagée) : le dernier arrivé voit les deux versions champ par champ et choisit. Pas d'écrasement silencieux.
- **OFF-15** Une action refusée n'est jamais perdue sans explication : elle apparaît dans un écran « Actions non synchronisées » avec la raison et, quand c'est possible, un bouton pour la refaire.
- **OFF-16** La file est rejouée par l'application à l'ouverture et au retour du réseau, et par la synchronisation en arrière-plan là où le navigateur la propose.
- **OFF-17** **Actions mises en file en v1** (précise OFF-10). Ajouter un souhait par saisie (un lien collé hors ligne est enregistré comme saisie et analysé au rejeu), modifier et retirer un élément de ma liste ; commenter ; « Je l'offre », participer et retirer sa participation ; cocher Acheté ; marquer une part réglée, « J'ai payé » ; confirmer une réception. Toute autre action est grisée hors ligne, avec la raison (UX-33).
- **OFF-18** **Réponse au rejeu** (précise OFF-12). `2xx` : acceptée, retirée de la file. `409`, `412`, `422`, `403`, `404` : refusée ou en conflit, montrée avec sa raison (OFF-15) et retirée de la file active. `423` : le rejeu attend le déverrouillage du profil. `401` : le rejeu s'arrête, la file est gardée jusqu'à la reconnexion du même compte. `429`, `5xx` et absence de réseau : nouvel essai, avec une attente croissante (de 5 secondes à 5 minutes). Une action n'est jamais rejouée sous un autre profil que celui qui l'a faite.
- **OFF-19** **Idempotence en file** (précise OFF-11). La clé naît avec l'intention de l'utilisateur et part avec l'action à chaque essai ; le serveur rend la première réponse pendant 30 jours (API-16, CPT-71). Une action encore en file après 30 jours n'est plus rejouée (elle pourrait l'être deux fois) : elle passe dans les actions non synchronisées, avec « Refaire ».

## Cloisonnement et sécurité du cache

- **OFF-20** Le cache local est **cloisonné par profil**. Changer de profil ferme la base du profil précédent ; les requêtes d'un profil ne peuvent pas lire le cache d'un autre.
- **OFF-21** Pour un profil protégé par PIN, le cache est chiffré avec une clé dérivée, délivrée par le serveur après validation du PIN et gardée en mémoire seulement. Hors ligne, un profil à PIN déjà déverrouillé sur l'appareil reste lisible jusqu'au verrouillage ; après verrouillage, il faut le réseau pour rouvrir.
- **OFF-22** La déconnexion efface tous les caches de données et la file d'attente du compte. Si la file n'est pas vide, un avertissement le signale avant.
- **OFF-23** L'appareil ne reçoit jamais plus que ce que le moteur de visibilité autorise : le cache ne peut donc rien contenir d'interdit. Quand un droit est retiré (RT-07), les données correspondantes sont purgées du cache.
- **OFF-24** Le service worker ne met jamais en cache les réponses d'authentification ni les réponses portant `Cache-Control: no-store`. Les réponses d'API ne sont pas mises en cache par le service worker lui-même, uniquement par la couche de données cloisonnée.
- **OFF-25** Option « appareil partagé » à la connexion : pas de cache de données persistant, session courte.
- **OFF-26** **Clé de cache** (précise OFF-21, décision du 2026-11-17 : réseau requis pour rouvrir un profil à PIN, pas de vérification locale du PIN). `GET /profiles/me/cache-key`, réservé au profil actif déverrouillé et marqué `no-store`, rend pour un profil à PIN une clé AES-256 dérivée côté serveur (HMAC-SHA-256 du secret `CACHE_KEY_SECRET`, de l'identifiant du profil, de son compte et de l'empreinte du PIN qui a déverrouillé la session, PIN-05) et un identifiant de clé dérivé à part ; pour un profil sans PIN, il indique qu'aucun chiffrement n'est demandé. Le client importe la clé non extractible et la garde en mémoire. Un PIN créé, changé, réinitialisé ou désactivé, ou un profil passé dans un autre compte, change la clé et son identifiant : l'ancien cache devient illisible, et le client l'efface.
- **OFF-27** **Réouverture hors ligne.** Un profil sans PIN rouvre son cache hors ligne : l'appareil retient le dernier profil actif. Un profil à PIN demande le réseau dès que la page est rechargée (la clé était en mémoire), comme après un verrouillage.
- **OFF-28** **Ce qui reste sur l'appareil.** Par profil, une base IndexedDB (lectures, images et file d'actions, chiffrées par la clé pour un profil à PIN). Pour l'appareil, une base de métadonnées : identifiant du compte, profils qui ont un cache, chiffré ou non, dernier profil actif, date de dernière ouverture. Aucun titre, nom, montant ni texte hors des bases de profil.
- **OFF-29** **Purges** (précise OFF-22 et OFF-23). Le cache d'un profil est effacé : à la déconnexion ; à la connexion d'un autre compte (toutes les bases qui ne sont pas à lui) ; quand le profil passe d'avec PIN à sans PIN, ou l'inverse, ou que son époque change ; sur `access.revoked` (pour le salon quitté) ; après 30 jours sans ouverture (OFF-07). Une session perdue (`401`) efface les lectures du profil mais garde sa file pour la reconnexion du même compte. Tous les onglets de l'application ouverts sur l'appareil appliquent la purge et le changement de profil (canal entre onglets).
- **OFF-30** **Appareil partagé en pratique** (précise OFF-25). La case se coche à la connexion. La session dure 12 heures au plus et expire après 2 heures sans activité ; `GET /session` l'indique (`sharedDevice`). Rien n'est écrit dans IndexedDB : lectures et file restent en mémoire ; fermer l'onglet avec une file non vide perd les actions, et l'application avertit avant. Aucun appareil de confiance (AUTH-12) n'est enregistré.

## Application installable

- **PWA-01** Manifeste complet : nom, icônes (dont masquables), couleurs, mode `standalone`, raccourcis (« Ajouter un souhait », « Mon panier »).
- **PWA-02** **Cible de partage** : depuis l'application d'un marchand ou le navigateur, « Partager → Wishlist » ouvre l'ajout de souhait avec le lien prérempli. C'est le chemin principal d'ajout sur mobile (Android ; sur iOS, repli par copier-coller détecté à l'ouverture, avec accord de l'utilisateur).
- **PWA-03** Invitation à installer proposée après un premier usage réussi (un souhait ajouté), jamais à la première visite. Sur iOS, mini-guide « Partager → Sur l'écran d'accueil ».
- **PWA-04** Notifications push demandées au moment où elles servent (première réservation, première invitation), avec explication avant la demande du navigateur.
- **PWA-05** Pastille sur l'icône pour les notifications non lues, sans jamais refléter une activité soumise à la règle de surprise.
- **PWA-06** Mise à jour de l'application : la nouvelle version s'installe en arrière-plan ; un bandeau « Nouvelle version, recharger » apparaît, jamais de rechargement forcé pendant une saisie.
- **PWA-07** **Enveloppe hors ligne** (précise OFF-01 et OFF-24). Le service worker garde les fichiers statiques du build et les pages de l'application déjà ouvertes, qui ne portent aucune donnée (les écrans lisent l'API dans le navigateur) ; hors ligne, il sert la page déjà ouverte, sinon une page d'enveloppe qui propose la suite. Les pages de connexion, de compte, de profils, de réglages et à jeton ne sont jamais gardées, et aucune réponse de `/api`, `/realtime` ou `/monitoring`, ni aucune requête autre que `GET`, n'entre dans ce cache commun à l'appareil.

## Interface adaptative

- **PWA-10** Mobile d'abord. Trois paliers : téléphone (navigation par barre inférieure, panneaux en tiroirs), tablette, bureau (navigation latérale, vue latérale de budget fixe).
- **PWA-11** Zones tactiles de 44 px au moins, gestes doublés d'un bouton, prise en compte des zones sûres des écrans à encoche.

## Critères d'acceptation

- En mode avion, l'application s'ouvre, mes listes et mon panier s'affichent, je coche un achat et j'ajoute un commentaire ; au retour du réseau, les deux sont enregistrés une seule fois.
- Une même action rejouée trois fois n'a d'effet qu'une fois.
- Après changement de profil, l'inspection du stockage du navigateur ne permet pas de lire les données du profil précédent s'il a un PIN.
- Après déconnexion, il ne reste aucune donnée de liste dans le stockage.
- Score Lighthouse PWA et performances mobile ≥ 90.

## Questions ouvertes

Aucune. La question 1 (vérification locale du PIN) est tranchée par OFF-26 : réseau requis, décision du 2026-11-17. La question 2 (durée de conservation) par OFF-07 : 30 jours.
