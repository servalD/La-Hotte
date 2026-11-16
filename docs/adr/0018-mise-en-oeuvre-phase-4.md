# ADR 0018 — Mise en œuvre de la phase 4 : fils, notifications, temps réel

**Statut :** accepté · 2026-11-16

## Contexte

La phase 4 ajoute trois canaux de sortie (fils de commentaires, notifications, trames temps réel) et deux canaux hors de l'application (push, e-mail). Chacun peut trahir une surprise (VIS-20, VIS-22, NOT-05), y compris par sa seule existence, son compteur ou son heure. L'ADR 0006 a choisi Socket.IO ; il reste à fixer les frontières entre modules, la façon dont chaque sortie passe par le moteur, et ce qui tourne en tâche de fond.

## Décision

### Modules et événements de domaine

- `conversations` : fils, messages, activité, réactions, suivi. `notifications` : production, centre, préférences, push, résumé. `realtime` : passerelle, salons, revérification. Aucun ne décide d'un accès : `visibility` gagne les fonctions `threadAccess`, `publicThreadOpen`, `activityThread` ; `lists` et `events` exposent par leur `index.ts` des lecteurs d'accès (`ItemAccessReader`, `EventAccessReader`) qui chargent les faits et rendent la décision du moteur pour un profil donné.
- Les modules se parlent par un **bus d'événements de domaine** (`AppEvents`, port du noyau partagé, implémenté dans le processus) : `lists` publie `item.changed` et `list.changed`, `events` publie `event.changed` et ses avis, `conversations` publie `comment.changed`, `catalog` publie `product.extracted`, `identity` garde son propre bus (`IdentityEvents`, ADR 0013) et y ajoute `security.notice`. `notifications` et `realtime` s'abonnent. Ainsi `lists` ne dépend ni de `conversations`, ni de `notifications`, ni de `realtime`, et aucun cycle n'apparaît.
- Un événement est publié **après** l'écriture validée en base (API-35). Le bus est dans le processus : un arrêt brutal entre l'écriture et la livraison perd l'avis (notification, trame, activité). C'est accepté : aucun de ces avis n'est une donnée de compta ni d'audit, et le client relit l'API à la reconnexion (RT-12).

### Temps réel

- Une trame ne porte que des identifiants (RT-08, API-32). Pour chaque émission, la passerelle parcourt les sockets du salon (`fetchSockets`, qui voit aussi celles des autres instances par l'adaptateur Redis), revérifie la session (`CheckSessionAccess`) et demande au moteur si ce profil voit la ressource sous la forme requise. La forme requise est donnée par le producteur : `all` (tout lecteur) ou `givers` (forme offreur seule). Le salon séparé d'offreurs (RT-03) reste une seconde barrière.
- Le numéro de séquence n'existe que pour les notifications (RT-12) : rejouer les trames de salon demanderait de les écrire par profil, pour un gain nul, puisque le client relit de toute façon par l'API.
- Les sockets portent leur session et leur profil (`socket.data`) ; elles sont fermées sur `session.revoked`, `profile.locked`, `session.profile_changed`, et revérifiées sur `circle.changed`, `list.changed`, `event.changed` (RT-10).

### Notifications

- Une notification est écrite pour un profil après passage par le moteur (NOT-10) et revérifiée à chaque lecture (NOT-11) : elle ne garde que des identifiants, et ses titres sont relus à l'affichage. Une notification devenue invisible n'est jamais supprimée, elle est seulement tue (elle reviendrait si le sujet redevenait visible, comme une liste).
- `seq` est tiré d'un compteur par profil (`notification_counter`, `UPDATE … RETURNING` dans la transaction de l'insertion) : strictement croissant, sans trou visible pour le profil.
- Push et résumé sont des **sorties différées** : la notification porte `push_due_at` (fin des heures calmes, ou tout de suite) ; une tâche planifiée du processus lit les push dues par `FOR UPDATE SKIP LOCKED`, revérifie l'accès, puis envoie. Plusieurs instances peuvent la lancer sans double envoi. Le résumé passe toutes les heures et envoie au plus un message par compte et par période due (NOT-17).
- Pas encore de service `worker` ni de BullMQ : comme la purge de la corbeille et la clôture des événements, ces tâches tournent dans l'API. Le worker naîtra quand une file aura besoin de reprise sur panne ou de débit (phase 7 au plus tard).

### Push

- Bibliothèque `web-push` (VAPID). Point de terminaison limité à une liste fermée d'hôtes de services de push (NOT-16) : c'est une URL fournie par le client que le serveur appelle, donc un risque de SSRF ; la liste ferme ce risque sans passer par le service `fetcher` (qui sert aux pages des boutiques).
- Un appareil a un abonnement (point de terminaison unique), rattaché à la session qui l'a créé (suppression en cascade avec elle) ; chaque profil qui active la push sur l'appareil y est rattaché (`push_subscription_profile`), avec son réglage de détail (NOT-15). Le modèle de `12` est corrigé en conséquence. À l'envoi, la session doit être encore vivante (`CheckSessionAlive`).

### Activité et suivi

- L'activité (COM-14) est écrite par `conversations` en réaction à `item.changed`, hors de la transaction de l'élément : un arrêt brutal peut la perdre (même raison que ci-dessus). Le fil où elle va est décidé par le moteur (`activityThread`) selon que l'auteur du geste est destinataire de la liste.
- Le suivi garde une ligne par (élément, profil) avec un booléen : un désabonnement explicite n'est pas annulé par un suivi d'office ultérieur (NOT-13).

## Raisons

- Un seul juge (invariant 2) : chaque sortie demande au moteur, profil par profil, au dernier moment possible.
- Les trames sans contenu suppriment toute une classe de fuites (une vue construite pour le mauvais profil) pour le prix d'une relecture par l'API, déjà nécessaire pour le rattrapage.
- Le bus de domaine garde les modules indépendants ; il est remplaçable par une boîte d'envoi transactionnelle si la perte d'avis devenait gênante.

## Conséquences

- Coût d'une émission : une vérification de session et une décision du moteur par socket abonnée. À l'échelle d'une famille, négligeable ; à surveiller si un salon dépasse quelques dizaines de sockets.
- Les tests temps réel montent un vrai serveur HTTP et deux clients Socket.IO (QA-13).
- Les sorties de la télémétrie s'étendent : texte d'un message, point de terminaison push et clés n'apparaissent nulle part (OBS-26 étendu).

## Alternatives écartées

- **Vues complètes dans les trames, construites par profil** : plus réactif d'un aller-retour, mais chaque trame devient une nouvelle surface de projection à tenir à jour avec `projection.ts`.
- **Boîte d'envoi transactionnelle dès maintenant** : écriture de l'avis dans la transaction métier, puis relais. Plus sûr contre la perte, mais il faudrait toucher chaque dépôt de `lists` et `events` ; reporté tant que la perte d'un avis reste sans conséquence.
- **Envoi des push par le service `fetcher`** : il est fait pour des pages et des images arbitraires, pas pour un protocole chiffré vers quelques hôtes connus ; la liste fermée d'hôtes suffit.
- **Abonnement push par profil** (modèle initial de `12`) : un navigateur n'a qu'un point de terminaison par enregistrement de service worker ; plusieurs profils sur un appareil exigeaient soit plusieurs lignes pour un même point de terminaison, soit une table de rattachement.
