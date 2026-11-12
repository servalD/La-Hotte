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

## Écriture hors ligne

- **OFF-10** Actions possibles hors ligne, mises en file :

| Action | Hors ligne | Remarque |
|---|---|---|
| Ajouter, modifier, retirer un élément de ma liste | ✔ | Un lien collé est analysé à la reconnexion |
| Commenter | ✔ | Affiché « en attente d'envoi » |
| Réserver, participer | ✔ en attente | Affiché « à confirmer », voir OFF-13 |
| Cocher Acheté, marquer une part réglée | ✔ | Cas d'usage : en magasin sans réseau |
| Confirmer une réception | ✔ | |
| Modifier une règle de visibilité | ✘ | Doit être effectif immédiatement |
| Inviter, créer un lien, publier au répertoire | ✘ | |
| Tout ce qui touche au compte, au PIN, à la sécurité | ✘ | |

- **OFF-11** Chaque action en file porte une clé d'idempotence, l'identifiant du profil qui l'a faite, et la version de la ressource qu'elle modifie.
- **OFF-12** À la reconnexion, la file est rejouée dans l'ordre. Le serveur répond pour chaque action : acceptée, refusée (droit perdu, ressource supprimée), ou en conflit (version dépassée).
- **OFF-13** **Réservations et participations** : tant que le serveur n'a pas confirmé, l'interface affiche « à confirmer » et ne compte pas la somme dans le budget comme acquise. En cas de refus (quelqu'un a complété entre-temps), une notification explique et propose le reste disponible.
- **OFF-14** **Conflit de modification** sur un élément (deux contributeurs d'une liste partagée) : le dernier arrivé voit les deux versions champ par champ et choisit. Pas d'écrasement silencieux.
- **OFF-15** Une action refusée n'est jamais perdue sans explication : elle apparaît dans un écran « Actions non synchronisées » avec la raison et, quand c'est possible, un bouton pour la refaire.
- **OFF-16** La file est rejouée par l'application à l'ouverture et au retour du réseau, et par la synchronisation en arrière-plan là où le navigateur la propose.

## Cloisonnement et sécurité du cache

- **OFF-20** Le cache local est **cloisonné par profil**. Changer de profil ferme la base du profil précédent ; les requêtes d'un profil ne peuvent pas lire le cache d'un autre.
- **OFF-21** Pour un profil protégé par PIN, le cache est chiffré avec une clé dérivée, délivrée par le serveur après validation du PIN et gardée en mémoire seulement. Hors ligne, un profil à PIN déjà déverrouillé sur l'appareil reste lisible jusqu'au verrouillage ; après verrouillage, il faut le réseau pour rouvrir.
- **OFF-22** La déconnexion efface tous les caches de données et la file d'attente du compte. Si la file n'est pas vide, un avertissement le signale avant.
- **OFF-23** L'appareil ne reçoit jamais plus que ce que le moteur de visibilité autorise : le cache ne peut donc rien contenir d'interdit. Quand un droit est retiré (RT-07), les données correspondantes sont purgées du cache.
- **OFF-24** Le service worker ne met jamais en cache les réponses d'authentification ni les réponses portant `Cache-Control: no-store`. Les réponses d'API ne sont pas mises en cache par le service worker lui-même, uniquement par la couche de données cloisonnée.
- **OFF-25** Option « appareil partagé » à la connexion : pas de cache de données persistant, session courte.

## Application installable

- **PWA-01** Manifeste complet : nom, icônes (dont masquables), couleurs, mode `standalone`, raccourcis (« Ajouter un souhait », « Mon panier »).
- **PWA-02** **Cible de partage** : depuis l'application d'un marchand ou le navigateur, « Partager → Wishlist » ouvre l'ajout de souhait avec le lien prérempli. C'est le chemin principal d'ajout sur mobile (Android ; sur iOS, repli par copier-coller détecté à l'ouverture, avec accord de l'utilisateur).
- **PWA-03** Invitation à installer proposée après un premier usage réussi (un souhait ajouté), jamais à la première visite. Sur iOS, mini-guide « Partager → Sur l'écran d'accueil ».
- **PWA-04** Notifications push demandées au moment où elles servent (première réservation, première invitation), avec explication avant la demande du navigateur.
- **PWA-05** Pastille sur l'icône pour les notifications non lues, sans jamais refléter une activité soumise à la règle de surprise.
- **PWA-06** Mise à jour de l'application : la nouvelle version s'installe en arrière-plan ; un bandeau « Nouvelle version, recharger » apparaît, jamais de rechargement forcé pendant une saisie.

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

1. OFF-21 impose le réseau pour rouvrir un profil à PIN verrouillé. Alternative : vérification locale du PIN, plus pratique mais attaquable hors ligne par force brute (4 chiffres). Défaut : réseau requis.
2. Durée de conservation du cache d'un profil inactif sur un appareil : 30 jours par défaut.
