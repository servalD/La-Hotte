# ADR 0013 — Modèle de session : jeton, stockage, pré-authentification, CSRF, limitation

**Statut :** accepté · 2026-11-13 · point « Ordre » précisé par l'ADR 0014

Précise l'ADR 0003 (sessions opaques côté serveur) et l'ADR 0011 (voie maison) sans les remplacer.

## Contexte

L'ADR 0003 fixe le principe : identifiant opaque en cookie, haché en base, état en Redis avec persistance en PostgreSQL, profil actif et PIN portés par la session, CSRF par `SameSite`, double soumission et `Origin`. L'ADR 0011 confie l'écriture du module `identity` au dépôt. Il reste à fixer, avant la tranche 1 de la phase 1, les détails dont dépend la sécurité : forme du jeton, ordre des écritures entre Redis et PostgreSQL, état intermédiaire avant le second facteur, liaison du jeton CSRF, comptage des échecs, ordre des gardes, ce que l'espace Compte a le droit de renvoyer.

Le produit protège la surprise contre des proches qui ont un accès légitime au même compte ou au même appareil : le PIN (PIN-02) est un état de session vérifié par le serveur, pas un verrou d'interface.

Cet ADR a été relu par `security-reviewer` le 2026-11-13 avant tout code ; ses points sont intégrés ci-dessous.

## Décision

### Jeton et cookies

- Jeton de 32 octets tirés par `node:crypto`, encodé en base64url, dans le cookie `__Host-lh_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`, sans `Domain`).
- Stocké en SHA-256 (`session.token_hash`). Un hachage lent est inutile : le jeton a 256 bits d'entropie.
- La session a aussi un `id` (UUID v7), seul identifiant exposé par l'API (`GET /sessions`, `DELETE /sessions/{id}`). Le jeton et son hash ne sortent jamais du serveur.
- Appareil de confiance (AUTH-12) : cookie `__Host-lh_device` (`HttpOnly; Secure; SameSite=Lax`), jeton de 256 bits haché en SHA-256 dans `trusted_device`, lié à un compte ; refusé s'il est présenté pour un autre compte.
- Toutes les réponses de `/session`, `/sessions`, `/auth/*`, `/account*`, `/trusted-devices` et `/profiles/me*` portent `Cache-Control: no-store` et sont exclues de la persistance hors ligne du client (OFF-20).

### Durées

- Glissante : 30 jours, 12 heures pour un compte `ADMIN` ou `MODERATOR` (AUTH-04).
- **Absolue** : 90 jours, 24 heures pour `ADMIN` ou `MODERATOR`, quelle que soit l'activité. Fixée à la création (`session.absolute_expires_at`) et vérifiée à chaque lecture, réhydratation comprise.
- Un changement de rôle, la suspension du compte (`SUSPENDED`), sa suppression, son remplacement (AUTH-15), le changement et la réinitialisation du mot de passe révoquent toutes les sessions du compte.

### Génération d'authentification du compte

- `account.auth_epoch` : entier incrémenté à chaque événement qui doit tout révoquer (changement ou réinitialisation du mot de passe, désactivation du TOTP, changement de rôle, suspension, suppression, remplacement). Sa valeur courante est aussi dans Redis (`acct-epoch:{account_id}`).
- Chaque session, chaque pré-authentification et chaque flux OIDC recopie l'époque à sa création. Toute lecture la compare à l'époque du compte ; différente → refus, puis révocation.
- **Ordre** : l'époque est d'abord augmentée dans Redis (ce qui déconnecte tout de suite, en échec fermé), puis la transaction PostgreSQL augmente `account.auth_epoch` **et** applique le changement (mot de passe, rôle, statut). Si la transaction échoue, le compte a seulement été déconnecté partout ; l'utilisateur recommence. La révocation ligne par ligne vient ensuite, comme nettoyage : son échec partiel ne laisse aucune session valide.

### Stockage

- **PostgreSQL est la source de vérité** (`session`), **Redis un cache** : clé `sess:{token_hash}`. L'expiration glisse dans Redis à chaque requête ; `last_seen_at` et `expires_at` sont recopiés en base au plus toutes les 5 minutes.
- Lecture : `MGET sess:{h} sess-revoked:{h}` en un aller-retour, puis `acct-epoch:{account_id}`. Marque présente, époque différente ou durée absolue dépassée → refus. Cache absent → lecture de la ligne de session et du compte en base (compte `ACTIVE`, même époque), puis **réhydratation atomique** par un script Lua qui n'écrit `sess:{h}` que si `sess-revoked:{h}` est absente.
- Ensemble `acct-sess:{account_id}` : aide à la révocation, jamais la référence. « Révoquer toutes les autres sessions » (AUTH-05) part des lignes de PostgreSQL ; l'ensemble Redis ne sert qu'à purger le cache.
- Redis ne contient ni e-mail, ni nom, ni adresse IP en clair : identifiants, horodatages et drapeaux ; les clés dérivées d'un e-mail ou d'une adresse IP sont des HMAC à clé serveur (`KEY_HMAC_SECRET`), pas des hachages simples qu'un dictionnaire renverserait.
- Redis tourne avec `maxmemory-policy noeviction` : une marque de révocation ou un compteur évincés rouvriraient une faille (BullMQ l'exige de toute façon). Vérifié par `/health/ready` (`CONFIG GET`, disponible sur notre Redis auto-hébergé ; avec un Redis géré qui l'interdit, la vérification passe dans la procédure de déploiement).

### Révocation

Pour chaque jeton révoqué, dans cet ordre :

1. marque `sess-revoked:{token_hash}` posée dans Redis pour **90 jours, quel que soit le rôle** (la plus longue durée absolue ; un rôle qui change ne la raccourcit pas), jamais d'après un `expires_at` en base qui peut avoir 5 minutes de retard ;
2. suppression de la ligne en base ;
3. `DEL sess:{token_hash}`.

Si le processus meurt après l'étape 1, la marque suffit : la lecture la voit dans le même `MGET`. Si Redis est indisponible, la révocation échoue et l'erreur remonte : on ne supprime pas la ligne sans avoir posé la marque.

**Aucune ligne `session` ne disparaît autrement** : la clé étrangère `session.account_id` est en `ON DELETE RESTRICT`, sans cascade. La purge des comptes non vérifiés, le remplacement d'un compte (AUTH-15) et la suppression d'un compte (RGPD-05) augmentent d'abord l'époque du compte, puis révoquent ses sessions par cette procédure, avant de supprimer le compte.

**Rotation** : nouvelle session (nouvel `id`, nouveau jeton) à chaque connexion ; même `id`, nouveau jeton à la ré-authentification. Dans les deux cas, **l'ancien jeton est révoqué** selon la procédure ci-dessus (connexion depuis un navigateur qui avait déjà une session : l'ancienne session est révoquée côté serveur, pas seulement écrasée dans le cookie). Le cookie CSRF est réémis.

Chaque révocation, chaque verrouillage et chaque changement de profil publient un événement interne (`session.revoked`, `profile.locked`, `session.profile_changed`). `identity/index.ts` expose `checkSessionAccess(sessionId, profileId)`. La passerelle temps réel (phase 4) les utilise pour fermer ou désabonner une socket : l'expiration passive du déverrouillage, qui n'émet rien, y est revérifiée à chaque émission.

### Pré-authentification

Quand le mot de passe ou Google est validé et que le TOTP est attendu (AUTH-12) :

- aucune session n'est créée ; un état de pré-authentification vit **dans Redis seul**, 5 minutes, désigné par le cookie `__Host-lh_pending` (`HttpOnly`), et ne permet que l'appel de vérification du second facteur ;
- les échecs du second facteur ont **leur propre compteur, par compte seul** (seuil 5, sans dispense pour un appareil de confiance), remis à zéro seulement par un succès du second facteur, jamais par un succès du mot de passe. Recommencer l'étape du mot de passe, ou changer d'adresse IP, ne donne aucun essai de plus ;
- la pré-authentification porte l'époque du compte : une réinitialisation du mot de passe l'invalide sans avoir à la retrouver ;
- au succès, la pré-authentification et `__Host-lh_presession` sont supprimées, et une session neuve est créée.

### Profil actif et PIN

L'ADR 0003 parlait des « profils dont le PIN est validé » ; on n'en garde qu'un, le profil actif, parce que changer de profil reverrouille (PIN-07).

- La session porte `active_profile_id` (choisi par `POST /session/profile`, API-11).
- Le déverrouillage du profil actif (PIN-02) est un horodatage tenu **dans Redis seulement**. Il n'est jamais écrit en base.
- **Seules les actions de l'utilisateur le rafraîchissent** : requêtes portant l'en-tête `X-User-Activity`, que le client pose sur une navigation ou une action explicite. Battements de cœur, `GET /session`, rafraîchissements en arrière-plan, synchronisation et WebSocket ne le prolongent jamais : une PWA laissée ouverte sur une tablette se reverrouille.
- Changer de profil efface le déverrouillage (PIN-07). Selon le réglage `pin_relock` du profil (12) :
  - `IDLE_15` : reverrouillage après 15 minutes sans action de l'utilisateur ;
  - `EVERY_OPEN` : `IDLE_15`, **plus** un cookie sans `Max-Age` (`__Host-lh_unlock`, nonce aléatoire comparé à celui de Redis) qui disparaît à la fermeture du navigateur. Le client appelle aussi `POST /session/lock` à chaque lancement de l'application : c'est une aide de l'interface, pas une barrière ;
  - `NEVER` : pas de reverrouillage par inactivité.
- **Une session réhydratée depuis PostgreSQL garde son profil actif mais verrouillé.** Le déverrouillage n'est jamais déduit d'un `last_seen_at` qui peut avoir 5 minutes de retard.
- `reauth_at` est effacé au changement de profil (`POST /session/profile`) et au verrouillage (`POST /session/lock`) : une ré-authentification faite dans l'espace Compte ne sert pas à la personne qui reprend l'appareil ensuite. Pour réinitialiser ou désactiver un PIN (PIN-05), elle doit dater de **moins de 2 minutes**, pour qu'un appareil laissé ouvert sur l'espace Compte ne suffise pas.

### Chaîne de gardes

Gardes NestJS globales, dans cet ordre, refus par défaut (SEC-01) :

| Garde          | Effet                                                                                                                         | Exception                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `SessionGuard` | Session valide exigée, sinon `401`                                                                                            | `@Public()` : liste explicite, vérifiée par le test « routes sans session » |
| `CsrfGuard`    | Toute méthode autre que `GET`, `HEAD`, `OPTIONS` : origine puis jeton, sinon `403 CSRF_REJECTED`                              | `@OidcCallback()` seulement (voir ci-dessous)                               |
| `ProfileGuard` | `@RequiresProfile()` : profil actif présent et déverrouillé, sinon `423 PROFILE_LOCKED`                                       | Routes de l'espace Compte, marquées `@AccountScope()` (PIN-08)              |
| `ReauthGuard`  | `@RequiresRecentReauth()` : `reauth_at` de moins de 10 minutes (2 minutes pour PIN-05), sinon `401 REAUTH_REQUIRED` (AUTH-14) |                                                                             |

- Une route porte exactement une marque parmi `@Public()`, `@AccountScope()`, `@RequiresProfile()` ; un test parcourt les routes et refuse une route sans marque ou avec deux.
- **Aucun `GET` ne modifie l'état**, sauf le retour OIDC marqué `@OidcCallback()`. Un test parcourt les routes `GET` et refuse toute autre exception.
- Les cas d'usage reçoivent la session et le profil actif par `@CurrentSession()` et `@ActiveProfile()`, jamais par un paramètre (API-11, SEC-03).
- **Une route `@RequiresProfile()` n'agit que sur le profil actif** : `/profiles/me`, jamais `/profiles/{id}`. Créer, supprimer un profil, ou réinitialiser et désactiver son PIN se fait dans l'espace Compte, après ré-authentification (PIN-05, AUTH-14).
- **Une route `@AccountScope()` ne renvoie que des métadonnées du compte** : e-mail, moyens de connexion, sessions, appareils de confiance, et pour chaque profil son identifiant, son nom, son avatar, la présence d'un PIN et le marqueur enfant. Jamais une liste, un élément, une donnée d'offreur ni un contenu de profil. Un test fige la forme des réponses de l'espace Compte. L'export des données (RGPD-04) se fait donc **depuis le profil**, avec son PIN, et non depuis l'espace Compte.

### Retour OIDC (Google)

Le retour de Google est une navigation venue d'un autre site : il ne peut pas porter de jeton CSRF. Il est protégé autrement :

- le flux démarre par un `POST`, protégé contre le CSRF : `POST /auth/google/start` (connexion ou inscription, jeton de pré-session) ou `POST /auth/google/link` (association, depuis une session). La réponse donne l'URL de Google, vers laquelle le client navigue ;
- `state`, `nonce` et `code_verifier` sont tirés et gardés **côté serveur** (Redis, 10 minutes), avec l'époque du compte pour une association, liés à l'identifiant de pré-session pour une connexion, ou à `session.id` pour une association ;
- au retour (`GET /auth/google/callback`, `@OidcCallback()`), refus si la pré-session ou la session courante n'est pas celle qui a démarré le flux ; `state` est à usage unique ;
- la chaîne de requête (`code`, `state`) est retirée des spans et des journaux pour tout `/auth/*`.

### CSRF

Deux barrières sur chaque mutation :

1. **Origine** : `Sec-Fetch-Site` doit valoir `same-origin` ; sans cet en-tête, `Origin` doit être celle de l'application (`WEB_ORIGIN`) ; sans les deux, refus.
2. **Double soumission signée** : cookie `__Host-lh_csrf` (lisible par le script, donc sans `HttpOnly`) contenant `HMAC-SHA256(CSRF_SECRET, "session:" ‖ token_hash courant)`, renvoyé par le client dans l'en-tête `X-CSRF-Token`. Le serveur recalcule et compare en temps constant. Le jeton change à chaque rotation ; un jeton d'une autre session ou d'avant rotation est refusé.

**Avant session** (inscription, connexion, réinitialisation, vérification d'e-mail, second facteur), contre le CSRF de connexion : identifiant de pré-session tiré par le serveur dans `__Host-lh_presession` (`HttpOnly`, 1 heure), et jeton = `HMAC-SHA256(CSRF_SECRET, "presession:" ‖ identifiant)`, obtenu par `GET /session` (public). Les préfixes séparent les deux usages du secret. Le préfixe `__Host-` empêche un sous-domaine de fixer ces cookies. Une connexion depuis un navigateur qui a déjà une session accepte le jeton de cette session ou celui de la pré-session.

Le client ajoute l'en-tête dans son mutateur (`packages/api-client/src/http/fetcher.ts`) ; `X-CSRF-Token` et `X-User-Activity` rejoignent les en-têtes autorisés de `apps/api/src/bootstrap.ts` (API-21), même si la même origine rend CORS sans objet en production.

### Liens envoyés par e-mail

Les jetons de vérification d'e-mail, de changement d'e-mail et de réinitialisation ne passent jamais dans une chaîne de requête vers l'API :

- le lien ouvre une page du web, jeton dans le **fragment** (`#`), qui n'est envoyé à aucun serveur ;
- la page envoie le jeton dans le **corps** d'un `POST` (`/auth/email/verify`, `/auth/password/reset/confirm`) : un scanner de messagerie qui suit le lien ne consomme rien ;
- ces pages portent `Referrer-Policy: no-referrer`.

### Limitation

- Port `RateLimiter`, adaptateur Redis. Clés : HMAC de l'e-mail normalisé, HMAC de l'adresse IP (réduite à son /64 en IPv6).
- **Même comptage pour tout e-mail, qu'il ait un compte ou non** : un `429` ne révèle pas l'existence d'un compte.
- Délai croissant (1 s, 2 s, 4 s… plafonné à 15 minutes), jamais de blocage définitif (AUTH-07). Compteurs du premier facteur :
  - par couple (compte, IP) à partir de 5 échecs ; **seul ce compteur est remis à zéro par un succès** ;
  - par compte seul à partir de 20 échecs, pour qu'un tiers qui connaît l'e-mail ne bloque pas facilement la victime ; depuis un appareil de confiance du compte, seuil relevé à 50 (un cookie d'appareil volé ne dispense pas de toute limite) ;
  - par IP seule à partir de 50 échecs, tous comptes confondus.
  - Les compteurs par compte seul et par IP seule décroissent avec le temps (fenêtre glissante d'une heure), jamais sur un succès : un attaquant ne les remet pas à zéro en se connectant à son propre compte.
- Second facteur : compteur propre, par compte seul, seuil 5 (voir « Pré-authentification »).
- **Pendant le délai, la tentative est refusée (`429`) sans évaluer les identifiants.**
- Réponse `429` avec `Retry-After` et les en-têtes `RateLimit-*` (API-18).
- **Limiteur indisponible** (Redis en panne) : `503` sur la connexion, le second facteur, la ré-authentification, le PIN et la réinitialisation. Jamais d'ouverture par défaut.
- S'applique à la connexion, au second facteur, à la ré-authentification, à la réinitialisation, à l'inscription, à la vérification du PIN (avec le délai propre de PIN-03), et aux **envois d'e-mail par adresse destinataire** (avertissement de tentative d'inscription, réinitialisation, changement d'e-mail), contre le bombardement d'une boîte.

### Anti-énumération

- Connexion : quand le compte n'existe pas **ou n'a pas de mot de passe** (compte Google seul), une vérification argon2 factice est faite contre un hash fixe, pour une durée comparable.
- Réinitialisation (AUTH-06), inscription (AUTH-09) et changement d'e-mail (`PUT /auth/email`) : même réponse, même forme, même délai, que l'e-mail soit connu ou non. Le titulaire de l'adresse déjà prise reçoit un e-mail d'avertissement ; aucun compte n'est créé ni modifié.
- L'envoi d'e-mail est mis en file ou fait après la réponse, pour que sa durée ne trahisse rien.
- En `INVITE_ONLY`, l'invitation n'est consommée qu'à la vérification de l'e-mail : son état ne révèle pas si une inscription a abouti.

### Adresse IP du client

En production, Caddy route `/api/*` **directement** vers le conteneur `api`, sans passer par Next (DEP-02). `trust proxy` d'Express est réglé sur un nombre de sauts (`TRUSTED_PROXY_HOPS`, 1 en production). Cette adresse est la seule utilisée par le limiteur et le journal de sécurité (SEC-30). Un test d'intégration vérifie l'adresse retenue avec un `X-Forwarded-For` forgé.

### Télémétrie

- Le sérialiseur de l'instrumentation ioredis est déjà réduit au nom de commande (`apps/api/src/platform/telemetry/telemetry.ts`) ; la tranche 1 le couvre par le test OBS-26.
- Aucun jeton, hash de jeton, cookie, en-tête `X-CSRF-Token`, code, mot de passe, e-mail ni paramètre de retour OIDC dans les journaux, spans, métriques et rapports d'erreur (SEC-31, OBS-20). Le test OBS-26 l'étend avec des marqueurs à la tranche 1.

## Raisons

- PostgreSQL en source de vérité : une perte de Redis déconnecte au pire les profils (reverrouillés), jamais ne ressuscite une session révoquée.
- La marque de révocation, lue dans le même aller-retour que la session et vérifiée atomiquement à la réhydratation, ferme la course qui reste quand deux magasins coexistent ; supprimer d'abord en base ne suffit pas.
- Le déverrouillage du PIN est l'état le plus sensible de la session (il garde la surprise entre profils d'un même compte) : il ne survit à aucune incertitude, ni au trafic automatique.
- L'espace Compte échappe au PIN par construction (PIN-08) : il ne peut donc rien renvoyer qu'un profil protégerait.
- Lier le jeton CSRF au jeton de session courant le fait tourner avec lui, sans état supplémentaire.
- Compter les échecs du second facteur par compte empêche de contourner la limite en recommençant le premier facteur.

## Conséquences

- Variables d'environnement nouvelles : `CSRF_SECRET`, `KEY_HMAC_SECRET`, `TRUSTED_PROXY_HOPS`, `REGISTRATION_MODE` (AUTH-09), paramètres SMTP ; validées au démarrage comme les autres.
- Une lecture Redis par requête, plus une écriture d'expiration glissante.
- Le client web lit un cookie (`__Host-lh_csrf`) : c'est la seule donnée de session accessible au script, et elle ne permet ni de se connecter ni de déduire le jeton. Il pose `X-User-Activity` sur les actions de l'utilisateur.
- En développement, les cookies `__Host-` exigent `Secure` : les navigateurs l'acceptent sur `http://localhost`.
- Le module `identity` passe par `security-reviewer` à chaque tranche (SEC-40).

## Alternatives écartées

- **Redis seul** : la persistance de Redis ne suffit pas à la liste des sessions ni à l'audit ; et une perte de données non sauvegardées déconnecterait tout le monde.
- **PostgreSQL seul** : une requête SQL de plus par appel, et pas d'expiration native.
- **Jeton CSRF lié à `session.id`** : ne change pas à la ré-authentification.
- **Jeton CSRF synchronisé stocké en session** : un état de plus pour la même garantie.
- **Compteur d'échecs du second facteur dans la pré-authentification seulement** : contourné en recommençant le premier facteur.
- **Marque de révocation vérifiée puis écriture du cache en deux commandes** : une révocation peut s'intercaler entre les deux.
- **Export des données depuis l'espace Compte** : contournerait le PIN de chaque profil.
