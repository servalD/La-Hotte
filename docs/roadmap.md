# Roadmap

Chaque phase livre quelque chose d'utilisable et de testé. On ne commence pas une phase tant que les critères de sortie de la précédente ne sont pas remplis.

## Choix du modèle par tâche

| Étiquette | Modèle | Quand |
|---|---|---|
| **opus** | Claude Opus 5.5 | Conception, découpage d'une phase en tâches, tout ce qui touche à l'authentification, au moteur de visibilité, à la compta, à l'extraction (SSRF, injection), au temps réel filtré ; revue de sécurité ; bug difficile |
| **sonnet** | Claude Sonnet 5.5 | Implémentation d'un cas d'usage déjà spécifié et découpé, écrans et composants, tests, CRUD, configuration, documentation |

Règle pratique : **Opus décide et vérifie, Sonnet exécute.** Une tâche `sonnet` doit pouvoir se faire en lisant une règle de spec et un fichier voisin ; si elle demande d'arbitrer, elle remonte en `opus`.

## Phase 0 — Socle

**État : livrée le 2026-11-12** (voir ADR 0010). Tests d'intégration verts contre PostgreSQL 17 et Redis 7 (Docker). Reste à constater sur GitHub : CI verte au premier envoi.

Objectif : un dépôt où tout changement passe par les mêmes contrôles.

| Tâche | Modèle |
|---|---|
| Monorepo, TypeScript strict, lint, formatage, règles d'architecture (QA-03) | sonnet |
| Docker Compose local (PostgreSQL, Redis), Prisma, première migration | sonnet |
| Squelette NestJS : module type à quatre couches, erreurs RFC 9457, validation, journalisation, santé | opus (le module type), sonnet (le reste) |
| Chaîne OpenAPI → Orval → `api-client`, vérification en CI (ADR 0009), essai sur une vue polymorphe | opus |
| Squelette Next.js : système de design, jetons, thèmes, i18n, composants de base, jetons d'animation | sonnet |
| CI complète (CI-01), en-têtes de sécurité, CSP | sonnet, revue opus |
| Tous les `CLAUDE.md` mis à jour avec les commandes réelles | sonnet |
| Trivy sur le dépôt en CI, action épinglée par commit, exceptions à échéance (CI-05 à CI-07) — ajouté le 2026-11-12 | sonnet |
| Épingler par commit les autres actions tierces du workflow (CI-07) | sonnet |

Sortie : une route d'exemple traverse les quatre couches, son client est généré, la CI est verte et refuse un import interdit.

## Phase 0 bis — Observabilité

Spec : `14` (OBS-01 à OBS-44), `09` (SEC-31). ADR 0012.

**À faire avant le premier code de la phase 1 qui manipule des mots de passe ou des sessions** : c'est là qu'une exception mal nettoyée fuit le plus. Les tâches 1 à 3 d'abord ; les suivantes peuvent s'intercaler.

| # | Tâche | Modèle |
|---|---|---|
| 1 | ~~**Essai**~~ **Fait le 2026-11-12.** Résultats dans l'ADR 0012 (section « Résultat de l'essai »), OBS-12, OBS-28 à OBS-35. Ce qu'il en change pour les tâches suivantes est ci-dessous | opus |
| 2 | ~~Profil Compose `obs` (OBS-44) : `otel-collector`, `openobserve`, `glitchtip` (un seul service, sans Valkey), `postgres-obs` (`max_locks_per_transaction=512`), configurations dans `ops/observability/`. `GLITCHTIP_DOMAIN` = l'URL réelle (OBS-35)~~ **Fait le 2026-11-12** : `docker compose --profile obs up -d`, GlitchTip `:8000`, OpenObserve `:5080`, OTLP `:4317`/`:4318` ; trace de contrôle livrée jusqu'à OpenObserve | sonnet |
| 3 | ~~API : `instrument.ts` chargé par `node --import` (OBS-12), `platform/telemetry` (SDK, exporteurs OTLP, Sentry avec `dataCollection` fermé et `openTelemetryIntegration()`, `beforeSend` qui pose le `trace_id`, OBS-28), variables d'environnement validées, **module `scrub`** (liste des attributs : OBS-29) et filtre d'exceptions (5xx seulement, OBS-25), corrélation `trace_id` dans pino, port `Metrics` dans le noyau partagé~~ **Fait le 2026-11-12** : `apps/api/src/platform/telemetry/`, `src/instrument.ts`, seconde barrière dans `ops/observability/otel-collector.yaml`. Essai de bout en bout : aucun marqueur dans GlitchTip, OpenObserve ni les journaux, même `trace_id` partout ; fuite du message par les cadres de pile trouvée et corrigée (OBS-45) | opus (scrub, filtre, port), sonnet (câblage) |
| 4 | ~~**Test de non-fuite de la télémétrie (OBS-26)** : exporteurs de test, marqueurs, CI bloquante. Doit couvrir, à l'endroit où ils sont branchés (revue de sécurité du 2026-11-12) : `sanitizeError` dans `SentryErrorReporter`, le sérialiseur `err` du module de journaux monté, `ScrubbingSpanExporter` et la vue de métriques dans `telemetry.ts`, les exceptions et rejets non gérés, et une requête Prisma `$queryRaw` portant un marqueur~~ **Fait le 2026-11-12** : `pnpm test:leak` (`apps/api/test/leak/`), dans le job d'intégration de la CI. Faux collecteur OTLP et faux GlitchTip, vrais exporteurs ; application montée avec routes de test (5xx, `$queryRaw`, métrique) et processus enfant chargé par `dist/instrument.js` (exception et rejet non gérés). Chaque canal doit être non vide. Contre-épreuve : chacune des barrières retirée une à une fait échouer le test. OBS-21 corrigé au passage (gabarit de route dans le journal de requête) | opus |
| 5 | ~~Web : `@sentry/nextjs` en erreurs seulement, `instrumentation.ts` pour les spans serveur, route `/monitoring` à liste blanche, CSP inchangée~~ **Fait le 2026-11-13** : `apps/web/src/lib/telemetry/`, `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/app/monitoring/route.ts` (OBS-33, OBS-47, OBS-48). Revue de sécurité sans point bloquant ; ses suites (tests de chaque barrière avec contre-épreuve, relais limité à notre origine et à une erreur par enveloppe, IPv6 par /64, chemins des spans de middleware, cadres forgés) sont faites. Essai contre un faux GlitchTip et un faux collecteur, `next start` : aucun marqueur (URL, `tracestate`, `baggage`, cookie, enveloppe) dans GlitchTip, les spans ni les journaux de Next ; `traceparent` respecté ; CSP inchangée ; aucune carte dans `.next/static` | sonnet, revue opus |
| 6 | ~~CI et déploiement : build avec cartes, `glitchtip-cli` compilée depuis crates.io `--locked` (OBS-35) pour `inject`, script `ops/observability/bundle-sourcemaps` pour le bundle et l'envoi (OBS-31, le `upload` de la CLI 1.0.0 est cassé), vérification côté serveur (OBS-34), au déploiement seulement, suppression des cartes de l'artefact servi, release = SHA~~ **Fait le 2026-11-13** : `ops/observability/bundle-sourcemaps.mjs` (`upload`, `strip`, `check`) et ses tests (`pnpm test:ops`, faux GlitchTip qui rassemble réellement les morceaux, contre-épreuve sur chaque barrière), `.github/workflows/deploy.yml` (manuel, par environnement), `BROWSER_SOURCEMAPS` dans `next.config.ts` et `turbo.json`, contrôle `check` après le build de la CI. Essai de bout en bout contre GlitchTip 7.0.0 local : erreur du navigateur résolue en TypeScript (OBS-34). Revue de sécurité sans point bloquant ; ses suites sont faites (deux jobs, le jeton hors du job qui exécute du code tiers ; garde `main` ; actions de `deploy.yml` épinglées par commit vérifié ; `check` plus strict que `strip`, plusieurs dossiers, liens signalés ; `strip` limité à la fin des fichiers), sauf la configuration GitHub et OBS-27, ci-dessous | opus (script et vérification), sonnet (CI) |
| 7 | Squelettes de `worker` et `fetcher` : même `instrument.ts` (au fil des phases où ils naissent) | sonnet |
| 8 | Métriques métier au fil des phases : refus d'autorisation (phase 1), extraction et coût (phase 2), files (phase 4) | sonnet |
| 9 | Tableaux de bord et règles d'alerte versionnés (OBS-05, OBS-42), canal d'alerte hors application (OBS-43), sonde externe (OBS-41), restrictions d'accès (OBS-27), rétentions (OBS-16) | opus (alertes, accès), sonnet (tableaux de bord) : en phase 7 |

**Suites de la revue de sécurité du 2026-11-12** (tâches 2 et 3), à traiter avant la phase 1 :

- `traceparent` venu d'internet : la racine publique ne respecte pas la décision d'échantillonnage d'un parent distant (`remoteParentSampled` et `remoteParentNotSampled` = échantillonneur racine), et Caddy retire `traceparent` et `tracestate` entrants. Le fetcher (phase 2) ne propage rien vers des hôtes externes. Déjà fait (tâche 4) : le `tracestate` du client est écarté à l'entrée (`TraceParentOnlyPropagator`) et à l'export (`scrubSpanContext`, et `set(span.trace_state, "")` au collecteur), ni exporté ni réinjecté dans les requêtes sortantes, vérifié par le test OBS-26. Fait le 2026-11-13 : l'échantillonnage du parent distant (tirage au hasard au même taux, OBS-15 ; l'échantillonneur racine `TraceIdRatioBasedSampler` n'a pas été retenu, l'identifiant de trace étant choisi par le client). Reste : le retrait par Caddy.
- ~~Port `Metrics` : liste blanche de clés d'étiquettes dans la vue du SDK (`createAllowListAttributesProcessor`) et contrôle de la forme des valeurs dans l'adaptateur, au lieu de la liste noire. Ajouter alors au test OBS-26 (`test/leak/leak-routes.controller.ts`, route `metric`) un marqueur sous une clé libre, qui passe aujourd'hui.~~ Fait le 2026-11-13 (OBS-02). Noms de métriques en liste fermée, étiquettes `code` et `kind` (plus de nombre : un petit montant aurait passé pour un statut), revue de sécurité sans point bloquant et ses suites faites. La contre-épreuve a révélé une fuite : `server.address` (hôte d'un appel sortant, posé par la métrique client de l'instrumentation HTTP ; en phase 2, le domaine d'une boutique) sortait ; la liste blanche de la vue la retire.
- Spans : passer de la liste noire à une liste blanche avant la phase 2 (attributs `gen_ai.*` de l'extraction).
- ~~Collecteur : nettoyer aussi les attributs des événements et des liens de span (`transform` sur `spanevent`).~~ Fait le 2026-11-13 pour les événements (OBS-22), vérifié sur un collecteur 0.165.0 en marche avec contre-épreuve. Les liens n'ont pas de contexte OTTL : nettoyés à la source seulement.
- ~~Journal de requête : gabarit de route au lieu du chemin résolu (OBS-21).~~ Fait le 2026-11-12 avec la tâche 4 : `route` sur la ligne de fin de requête, ni chemin ni chaîne de requête dans `req`.
- Image de l'API (pas encore de Dockerfile) : vérifier que `APP_ROOT` (`apps/api/src/platform/telemetry/scrub.ts`) désigne la racine de l'application dans l'image ; sinon aucun cadre n'est de confiance et les piles sont vides.
- Lisibilité des piles : cadres `eval` et `async Promise.all (index n)` écartés par le filtre de confiance ; à rouvrir si cela gêne.
- Production : `Host` validé par Caddy, identifiants du collecteur par `${env:…}`, récepteur OTLP limité au réseau interne (OBS-27).

**Suites de la revue de sécurité de la tâche 4** (non bloquantes) :

- `X-Request-Id` : une valeur du client conforme au motif (`Velo-pour-Marie`) est reprise dans chaque ligne de journal et dans les étiquettes GlitchTip. Restreindre au format UUID (le client web en génère) ou consigner le choix dans OBS-21 et SEC-31.
- Niveau `debug` : le test OBS-26 tourne en `info`. Décider dans la spec : `debug` interdit en production, ou test aussi à ce niveau.
- Test OBS-26 à étendre au fil des phases : montants passant jusqu'à Prisma et aux métriques (compta), valeurs écrites dans Redis (`dbStatementSerializer` d'ioredis), sorties du worker et du fetcher.
- `route` du journal : ne contient que le sous-chemin si un `express.Router` est un jour monté sous un préfixe.
- Collecteur : `error_mode: ignore` sur `filter/exception-events` et `transform/status-message` laisse passer un lot non nettoyé en cas d'erreur d'exécution. Passer à `propagate` (le lot est abandonné) ou consigner le choix, et vérifier sur un collecteur en marche que `trace_state` arrive vide dans OpenObserve.
- Test OBS-26, volet A : la capture de sortie ne voit pas une écriture directe sur les descripteurs 1 et 2 (second logger pino, `fs.writeSync`, code natif). Lancer aussi le volet A dans un processus enfant dont on lit la sortie brute, comme le volet B.

**Suites de la tâche 5** (web) :

- **Bloque toute collecte des journaux du conteneur web** (revue de sécurité de la tâche 5) : Next écrit lui-même l'erreur brute, message compris, sur sa sortie d'erreur (`uncaughtException:`, `unhandledRejection:`, erreurs de rendu), ce qui viole l'invariant 7 dès que ces journaux sont lus ou collectés ; nos gestionnaires ne signalent qu'une copie nettoyée (OBS-48). Avant la tâche qui collectera ces journaux (tâche 9, ou le déploiement) : filtrer ces lignes, ou remplacer la journalisation des erreurs de Next. D'ici là, `docker logs` du web reste réservé à l'exploitation.
- Déploiement : vérifier que le port de Next n'est pas publié et que Caddy ne déclare pas de `trusted_proxies` (hypothèse du débit du relais, OBS-33).
- Comme dans l'API, risques acceptés : une ligne de message de la forme `at Nom (<anonymous>)` passe pour un cadre (OBS-45) ; un `traceparent` entrant marqué échantillonné force l'échantillonnage (voir la suite « échantillonnage du parent distant » ci-dessus, à traiter pour les deux).
- Test OBS-26 à étendre au web : serveur Next lancé par `next start` avec faux collecteur et faux GlitchTip (fait à la main le 2026-11-13), erreur de rendu provoquée, et une erreur du navigateur par Playwright jusqu'au relais.
- Trois copies de la liste d'attributs interdits (API, web, collecteur) : un test du web vérifie l'alignement avec l'API. Un paquet partagé (`packages/telemetry`) serait plus sûr quand le worker et le fetcher naîtront (tâche 7).
- Le span racine de Next (`next.bubble`) ne connaît pas la route : il s'appelle `GET (route inconnue)`, et sans `traceparent` entrant il n'est pas dans la même trace que les spans de rendu (comportement de Next).
- Au démarrage, `@sentry/nextjs` écrit un avertissement (« Failed to register diagnostics-channel injection hooks ») : sans contenu, sans effet (Sentry ne crée pas de spans).
- ~~Pas d'erreur du navigateur provoquée de bout en bout dans un vrai navigateur : à faire avec la tâche 6 (cartes et pile lisible, OBS-34).~~ Fait à la main le 2026-11-13 avec la tâche 6 (voir OBS-34).

**Suites de la tâche 6** (cartes de source) :

- `deploy.yml` s'arrête aux cartes : l'image du web, la migration, la santé et la bascule (DEP-04) viendront avec le premier serveur, **à partir du `.next` produit par le job `web`, sans rebuild** (les identifiants de débogage sont propres à ce build). Toute étape qui publie dépend du succès de `check`, jamais `if: always()`. L'analyse Trivy de l'image (CI-05) s'y ajoutera.
- **Avant de créer le secret** (revue de sécurité de la tâche 6, N1, N4) :
  - environnements GitHub `preview` et `production` avec « Deployment branches and tags » limité à `main` (la garde `if: github.ref == 'refs/heads/main'` du workflow ne suffit pas : une branche peut la retirer), relecteur obligatoire sur `production` ;
  - variables du dépôt `NEXT_PUBLIC_SENTRY_DSN_PREVIEW` et `NEXT_PUBLIC_SENTRY_DSN_PRODUCTION` (données publiques) ; variables d'environnement `GLITCHTIP_URL`, `GLITCHTIP_ORG`, `GLITCHTIP_PROJECT` ; secret `GLITCHTIP_AUTH_TOKEN` d'un utilisateur GlitchTip de service, membre de la seule organisation utile, droit `project:releases`, un jeton par environnement ;
  - **trancher OBS-27** : pour joindre GlitchTip depuis `ubuntu-latest`, il faudrait l'ouvrir à Internet (les plages d'adresses de GitHub sont partagées par tous ses clients, une liste d'adresses ne restreint rien). Une exception limitée aux routes d'envoi exposerait l'authentification de GlitchTip : écartée. Options : exécuteur auto-hébergé sur le réseau d'exploitation, ou envoi lancé depuis le serveur de déploiement, qui joint déjà GlitchTip en interne (le script n'a besoin que de Node). À décider avec le premier serveur.
- `cargo install --locked` : au premier passage, vérifier dans le journal que `glitchtip-cli` 1.0.0 publie bien son `Cargo.lock` (sinon Cargo avertit « no Cargo.lock file published » et résout les dernières versions).
- Risque accepté : `response.json()` sans limite de taille dans le script ; un GlitchTip malveillant pourrait épuiser la mémoire de l'exécuteur, impact négligeable.
- Test automatique OBS-34 en préproduction (page qui lève une erreur, présente seulement hors production).
- Rust de l'exécuteur : `cargo install --locked` fige les dépendances de la CLI, pas la version du compilateur, qui suit l'image `ubuntu-latest`. À fixer (`rustup toolchain install <version>`) si un build devient non reproductible.
- Les cartes de l'API (OBS-32) ne sont pas envoyées : `--enable-source-maps` suffit. Le serveur Next n'est pas lancé avec `--enable-source-maps` : ses piles (déjà réduites aux cadres de confiance, OBS-45) restent en JavaScript compilé. À décider si cela gêne.
- Supprimer le script quand une version de `glitchtip-cli` aura été vérifiée de bout en bout (OBS-31).

Sortie : critères d'acceptation « observabilité » de `14` pour l'API et le web ; test OBS-26 vert en CI ; `security-reviewer` sans point bloquant sur `scrub`.

**Versions à épingler** (relevées par l'essai du 2026-11-12, à vérifier à l'installation) :

| Composant | Version | Remarque |
|---|---|---|
| GlitchTip | 7.0.0 | image `glitchtip/glitchtip`, un seul service |
| `glitchtip-cli` | 1.0.0 | compilée depuis crates.io `--locked` ; seul `sourcemaps inject` est utilisé |
| `otel/opentelemetry-collector-contrib` | 0.165.0 | |
| OpenObserve | v1.1.2 | mot de passe racine : 8 caractères au moins, avec majuscule, chiffre et caractère spécial |
| `@sentry/nestjs`, `@sentry/nextjs` | 11.12.0 | `dataCollection` fermé ; `enableOpenTelemetrySetup` à `false` pour Next (vrai par défaut) |
| `@opentelemetry/sdk-node` | 0.301.1 | |
| `@opentelemetry/instrumentation-http` | 0.301.1 | pas la 0.301.2 (dépendance jamais publiée) |
| `@prisma/instrumentation` | 6.19.x | pas la 7.x (fait échouer les requêtes avec Prisma 6.19) |

## Phase 1 — Comptes, profils, authentification

Spec : `01`, `09`, `12` (identité), `13` (API-21). ADR 0003, ADR 0011 (essai de Better Auth fait le 2026-11-12 : voie maison retenue), ADR 0013 (modèle de session).

**Découpage fait le 2026-11-13** (opus) : ADR 0013, AUTH-08 (âge), AUTH-09 (mode d'inscription), AUTH-15 (compte non vérifié), AUTH-16 (changement d'e-mail), API-21 (CSRF, activité de l'utilisateur), table `account_token` et réglage `pin_relock` dans `12`, routes de profil limitées au profil actif, espace Compte limité aux métadonnées, export depuis le profil. Relu par `security-reviewer` le même jour.

Branche `feat/phase-1`, PR #9 en brouillon. Une tranche par session. Dépendances : 1 → 2 → 3, 4, 5 (dans n'importe quel ordre) → 6 ; les écrans (7) suivent chaque contrat d'API généré ; 8 clôt la phase. `security-reviewer` obligatoire après les tranches 1 à 5 et 8 (SEC-40). Les tests de non-fuite de la télémétrie de chaque tranche sont écrits avant son code (QA-10).

| # | Tranche | Modèle | Contenu | Sortie et tests attendus |
|---|---|---|---|---|
| 1 | Socle de session | opus | Migration des tables d'identité (`account`, `account_token`, `session`, `trusted_device`, `auth_identity`, `recovery_code`, `profile`, `security_log` avec `REVOKE` DAT-02, `CHECK` DAT-01) ; module `identity` à quatre couches ; ports `SessionStore` (PostgreSQL + Redis : `MGET` session et marque, époque du compte `auth_epoch`, durée absolue, réhydratation atomique en Lua, marque de révocation de 90 jours, rotation = révocation de l'ancien jeton, `session.account_id` en `RESTRICT`), `RateLimiter` (compteurs par couple compte-IP, compte, IP ; clés HMAC ; `503` si Redis est indisponible), `SecurityLog`, `MailSender` (nodemailer ; Mailpit ajouté à `docker-compose.yml`) ; événements internes `session.revoked`, `profile.locked`, `session.profile_changed` et `checkSessionAccess` dans `identity/index.ts` ; gardes et décorateurs de l'ADR 0013 (`@OidcCallback()` compris) ; CSRF et `X-User-Activity` (API-21) ; `Cache-Control: no-store` ; `GET /session` ; variables `CSRF_SECRET`, `KEY_HMAC_SECRET`, `TRUSTED_PROXY_HOPS`, `REGISTRATION_MODE`, SMTP ; Redis local en `noeviction`, vérifié par `/health/ready` ; `X-Request-Id` restreint au format UUID (suite de la tâche 4 de la phase 0 bis) ; `PHASE0_VIEWER` du module `example` remplacé | Tests : toute route sans session refusée hors liste publique (critère de `09`) ; toute route porte une et une seule marque ; aucun `GET` ne modifie l'état hors `@OidcCallback()` ; course révocation/réhydratation ; panne entre la marque et la suppression ; ancien jeton refusé après rotation ; réhydratation = profil verrouillé ; trafic automatique sans `X-User-Activity` ne prolonge pas le déverrouillage ; adresse du client avec `X-Forwarded-For` forgé. Test OBS-26 étendu : jeton, hash, cookies, `X-CSRF-Token` et commandes Redis (sérialiseur déjà réduit dans `telemetry.ts`) absents de la télémétrie |
| 2 | Comptes par mot de passe | opus | Inscription (AUTH-01, 02, 08, 09 ; premier profil, PRO-01), vérification d'e-mail (jeton dans le fragment puis le corps), compte non vérifié (AUTH-15, purge à 7 jours), connexion, déconnexion, réinitialisation (AUTH-06 : révoque tout), changement de mot de passe (époque augmentée avant la transaction) et d'e-mail (AUTH-16, avec annulation par l'ancienne adresse), liste et révocation des sessions (AUTH-05, révocation partant de PostgreSQL) ; limite d'envoi d'e-mails par destinataire ; ports `PasswordHasher` (`@node-rs/argon2`), `PasswordBreachChecker` (k-anonymat) | Énumération impossible à la connexion (compte absent ou sans mot de passe), à l'inscription, à la réinitialisation et au changement d'e-mail, y compris par le `429` (forme et durée) ; autres sessions invalides après changement de mot de passe ; toutes après réinitialisation ; mot de passe, e-mail et jetons absents de la télémétrie |
| 3 | TOTP et ré-authentification | opus | Activation, codes de secours hachés (SEC-22), anti-rejeu (AUTH-11), secret chiffré AES-GCM (clé hors base), pré-authentification et compteur par compte (AUTH-07), appareils de confiance révocables (AUTH-12), ré-authentification (AUTH-14), TOTP obligatoire pour `ADMIN` et `MODERATOR` (AUTH-13) | Code TOTP refusé la deuxième fois ; pas d'essai de plus en recommençant le mot de passe ; code et secret absents de la télémétrie |
| 4 | Google OIDC | opus | `openid-client`, code + PKCE, vérification de `iss`, `aud`, `nonce`, `email_verified` ; `state`, `nonce` et `code_verifier` gardés côté serveur et liés à la pré-session ou à la session ; association démarrée par `POST /auth/google/link` (AUTH-03) ; remplacement d'un compte local non vérifié (AUTH-15) ; jeton d'invitation en `INVITE_ONLY` ; TOTP après Google (AUTH-12) | Compte Google puis mot de passe = même compte ; aucune fusion sur e-mail non vérifié ; retour OIDC rejoué dans une autre session ou pré-session refusé ; `code`, `state` et jetons Google absents de la télémétrie |
| 5 | Profils et PIN | opus | Profil actif (`/profiles/me`, PRO-02, PRO-03), profils dans l'espace Compte (`/account/profiles`, PRO-01, PRO-06, 10 au plus), sélection (`POST /session/profile`, efface `reauth_at`), `POST /session/lock`, PIN (PIN-01 à PIN-08, `pin_relock`, `EVERY_OPEN` avec `__Host-lh_unlock`), délai croissant et e-mail au compte (PIN-03), `pin_reset_notice_at` ; métrique des refus d'autorisation (tâche 8 de la phase 0 bis) | Critères PIN de `01` : `423` sans PIN validé ; changement par l'ancien PIN sans ré-authentification ; désactivation seulement depuis l'espace Compte, avec ré-authentification de moins de 2 minutes (PIN-05), perdue au changement de profil ; forme des réponses de l'espace Compte figée par un test ; PIN absent de la télémétrie |
| 6 | Liens, cercle, invitations, blocage | sonnet, revue opus | LNK-01 à LNK-05, `AWAITING_GUARDIAN` (PRO-05), table `invitation` (`LINK` maintenant, `LIST` et `EVENT` plus tard), jetons de 128 bits ; lecture du cercle exposée par `identity/index.ts` pour le futur module `visibility` ; inscription par invitation (AUTH-09) | Rupture de lien : accès retirés à la requête suivante ; aucune recherche hors du cercle (LNK-04) ; blocage réciproque |
| 7 | Écrans | sonnet | Inscription, connexion, second facteur, réinitialisation, sélecteur de profil, saisie du PIN, espace Compte (e-mail, mot de passe, TOTP, Google, sessions, appareils, profils), réglages du profil, cercle et invitations ; langue du profil dans next-intl ; `X-CSRF-Token` dans `fetcher.ts` ; `POST /session/lock` au lancement ; retrait du module `example` (API et web, en deux déploiements, DAT-07) | Parcours Playwright bureau et mobile avec axe ; textes relus avec `design:ux-copy` |
| 8 | Tests de sécurité transverses | opus | Énumération (connexion, inscription, réinitialisation) ; CSRF (origine étrangère, jeton absent, d'une autre session, d'avant rotation, CSRF de connexion) ; fixation ; force brute du second facteur par pré-authentifications successives ; routes sans session ; IDOR sur les profils et sessions d'un autre compte ; rejeu des jetons à usage unique | Critères d'acceptation de `01` ; `security-reviewer` sans point bloquant |

**Tranche 1 faite le 2026-11-13** (opus). Module `identity` à quatre couches ; migration `20261113103012_identity` ; `GET /session` ; chaîne de gardes en une seule garde globale (`IdentityGuardChain`, ordre fixe) ; Mailpit dans `docker-compose.yml` ; test OBS-26 étendu aux secrets de session et aux commandes Redis. Choix faits dans les silences de l'ADR 0013, à relire :

- le déverrouillage du profil n'est **pas** conservé à la rotation : un verrouillage concurrent ne peut pas être annulé, le profil se redéverrouille par son PIN ;
- le rafraîchissement du déverrouillage (`X-User-Activity`) est un compare-and-set : il ne touche que le déverrouillage lu par la requête, jamais un verrouillage arrivé entre-temps ;
- révocation par `id`, quel que soit le hash courant : une rotation concurrente ne la contourne pas ;
- toutes les 5 minutes, le cache est confronté à PostgreSQL (ligne, époque, compte actif) : un instantané ancien de Redis ne ressuscite une session que 5 minutes au plus ;
- toute réponse faite à une session porte `no-store`, posé par la garde (le cookie est commun aux profils d'un compte) ;
- les refus CSRF vont au journal de sécurité une fois par minute et par adresse (/64 en IPv6), pour qu'un anonyme ne remplisse pas une table en ajout seul ;
- sans profil actif, une route `@RequiresProfile()` répond aussi `423 PROFILE_LOCKED` ; le client lit `GET /session` pour savoir s'il faut l'écran de sélection ou le PIN ;
- `checkSessionAccess` traite `EVERY_OPEN` comme `IDLE_15` (une socket ne porte pas le cookie `__Host-lh_unlock`) ;
- époque du compte = max(Redis, PostgreSQL), double incrément et époque lue avant les identifiants (ADR 0014) ; si la transaction a échoué, la base est rattrapée vers l'avant à la lecture suivante, ce qui laisse se reconnecter ;
- le limiteur réserve chaque essai autorisé (10 s au plus) : sous le seuil, échecs et essais en cours ne dépassent jamais le seuil ensemble ; au-delà, un seul essai à la fois. Une rafale parallèle n'est donc pas évaluée avant d'être comptée ;
- fenêtre de 24 h pour le couple (compte, IP) et le second facteur (l'ADR ne fixe que leur remise à zéro) ;
- un refus en échec fermé (`503`, Redis absent) est compté comme erreur métier, pas envoyé à GlitchTip : la panne se voit dans `/health/ready` ;
- `security_log.account_id` sans clé étrangère : le journal survit à la suppression du compte pendant sa conservation (SEC-33) ;
- 10 profils au plus garantis par un déclencheur (`profile_limit_per_account`).

Suites :

- Seuils de limitation de la ré-authentification, de la réinitialisation, de l'inscription, du PIN et des envois d'e-mail par destinataire : à écrire dans la spec avec la tranche qui les utilise (seules les portées de l'ADR existent dans `rate-limit.ts`).
- Sous Vitest, le client `ioredis` de l'application est chargé en ESM et n'est pas instrumenté ; le test OBS-26 passe par un client chargé par `require`, comme l'API compilée. La barrière est double (sérialiseur de `telemetry.ts` et filtre `db.*` de `scrub.ts`) : retirer l'une seule laisse le test vert, retirer les deux le fait échouer.
- Revue `security-reviewer` du 2026-11-13 (cycle 1) : B1 à B3 et I1 à I5 corrigés, M1, M2, M4 à M8 aussi. Restent : M3 (`REVOKE` de la migration sauté sans bruit si le rôle applicatif porte un autre nom : à vérifier dans la procédure de déploiement, le test d'intégration DAT-02 le couvre en CI), M9 (pré-session bornée par le seul `Max-Age` du cookie, accepté), M10 (voir le point Vitest ci-dessus).
- Revue `security-reviewer` du 2026-11-13 (cycle 2) : visa SEC-40 donné. Ses huit points mineurs ont été corrigés à la demande de l'utilisateur : marque posée avant toute lecture en base à la révocation ; révocation limitée au compte de la référence ; refus à la recopie limité au jeton lu (`revokeToken`) ; `GREATEST` et étape 3 perdue écrits dans l'ADR 0014 ; refus CSRF regroupés par (adresse, compte) et règle écrite dans SEC-30 ; déclencheur `profile_account_matches_sessions` ; test des `GET` avec `X-User-Activity` et dépôts des autres modules. Cycle 3 : visa maintenu, aucun point bloquant ni important. Trois points mineurs, à traiter en tranche 2 :
  1. La révocation marque le `tokenHash` reçu avant de vérifier le compte : une route `DELETE /sessions/{id}` qui construirait elle-même un `SessionRef` permettrait de déconnecter la session d'un autre compte. Offrir un seul point d'entrée `revokeOwned(accountId, sessionId)` qui lit le hash par `id` et `account_id`.
  2. Les déclencheurs `session_active_profile_same_account` et `profile_account_matches_sessions` ne se verrouillent pas mutuellement (théorique : aucun parcours ne déplace un profil). Ajouter `SELECT … FOR SHARE` sur le profil dans le déclencheur de session.
  3. `mark` et `dropCache` ne contrôlent pas le résultat de `exec()` : une commande refusée dans un `MULTI` passe sans erreur. Contrôler `[[err, res]]` et lever `IdentityUnavailableError`.
- Purge du journal de sécurité après 12 mois (SEC-33) : rôle de purge à définir avec le premier serveur (le rôle applicatif n'a pas `DELETE`).
- Le compteur `acct-sess:{account_id}` n'expire qu'avec la plus longue durée absolue ; une session expirée y laisse son hash jusqu'à la révocation suivante (nettoyage seulement).

**Tranche 2 faite le 2026-11-13** (opus). Routes `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/reauth`, `/auth/email/verify`, `/auth/email/cancel`, `/auth/password/reset`, `/auth/password/reset/confirm`, `PUT /auth/password`, `PUT /auth/email`, `GET /sessions`, `DELETE /sessions/{id}` ; ports `AccountRepository`, `PasswordHasher` (`@node-rs/argon2` 2.2.2), `PasswordBreachChecker` (Have I Been Pwned, plage par préfixe avec bourrage), `BackgroundTasks`, `IdentitySettings` ; seuils de limitation et durées des jetons écrits dans `01` ; points mineurs 1 à 3 de la revue de la tranche 1 traités (`revokeOwned`, `FOR SHARE` dans le déclencheur de session, résultat des `MULTI` contrôlé). Choix faits dans les silences, à relire :

- **la ré-authentification par mot de passe est livrée ici** (`POST /auth/reauth`), parce que `PUT /auth/password` et `PUT /auth/email` l'exigent (AUTH-14) ; la tranche 3 y ajoute le TOTP, la tranche 4 Google. D'ici là, un compte à TOTP actif est refusé en échec fermé (`503`) à la connexion et à la ré-authentification (aucun ne peut l'activer) ;
- l'inscription ne crée pas de session ; un compte non vérifié ne se connecte pas par mot de passe (même `401` qu'un mot de passe faux, décision de l'utilisateur du 2026-11-13, AUTH-15) . Le lien de vérification **n'ouvre pas de session** (`204`) : on se connecte ensuite. Un premier essai où le lien ouvrait la session a été retiré après la revue du cycle 2 (C2-B1) : qui cliquait le lien d'une inscription faite par un proche entrait dans un compte dont le proche connaissait le mot de passe ; désormais il passe par la réinitialisation, qui évince le proche (décision de l'utilisateur) ;
- anti-énumération par **tâche de fond** : inscription, demande de réinitialisation et demande de changement d'e-mail ne font avant la réponse que la limitation, la validation et (inscription) le contrôle des fuites et le hachage argon2, faits dans tous les cas ; recherche de l'adresse, écritures et e-mails viennent après. Le mot de passe en clair ne passe jamais dans la tâche, seulement son hash ;
- tâches de fond **dans le processus** (`InProcessBackgroundTasks`, attendues à l'arrêt propre) : un arrêt brutal perd l'e-mail en cours ; on redemande. Une file persistante (BullMQ) pourra les remplacer derrière le même port ;
- connexion : l'époque est lue avant le hash vérifié (l'adresse ne sert qu'à trouver l'identifiant, le hash est relu après l'époque, ADR 0014) ; sans compte, mêmes appels avec un identifiant nul, à un aller-retour Redis près (écart de l'ordre de la fraction de milliseconde, noyé dans argon2 et freiné par la limitation : accepté) ; hash factice tiré au démarrage ;
- compte suspendu : `403 ACCOUNT_SUSPENDED`, seulement après un mot de passe juste ;
- changement de mot de passe : l'époque augmente, toutes les sessions tombent (celle de l'appelant comprise), puis une session neuve est ouverte pour l'appelant, sans profil actif ;
- réinitialisation : le nouveau mot de passe est contrôlé avant de consommer le jeton (un refus pour fuite ne brûle pas le lien) ; aucune session n'est ouverte ;
- le quota d'envoi compte chaque envoi, réussi ou non, **par destinataire et par sorte d'e-mail** ; au-delà, l'e-mail est retenu sans erreur. Pour le changement d'e-mail, l'avertissement de l'ancienne adresse part en premier ; s'il est retenu, rien d'autre ne part (sinon un tiers épuiserait d'abord le quota de la victime pour changer l'adresse en silence) ;
- un jeton est consommé seulement si son compte est `ACTIVE` ; un changement d'e-mail confirmé invalide les jetons `EMAIL_VERIFY` et `EMAIL_CHANGE` ouverts ;
- **annulation d'un changement d'e-mail** (AUTH-16, après la revue du cycle 1 et la décision de l'utilisateur) : tout ou rien dans une transaction, jeton consommé compris (revue du cycle 2, M1 et M2 : si l'adresse n'est plus libre, rien n'est écrit et le lien reste utilisable ; les sessions sont tout de même tombées à l'étape E+1). Elle désarme les liens d'annulation émis après le sien et tous les liens de vérification, de confirmation et de réinitialisation ouverts, **efface le mot de passe**, rétablit l'adresse et envoie un lien de réinitialisation à cette adresse seulement. Un lien d'annulation ouvert **réserve** son adresse : inscription et changement vers elle depuis un autre compte sont traités comme pour une adresse prise (contrôle hors de la transaction qui écrit : fenêtre de quelques millisecondes, acceptée, revue du cycle 2, M3). Le lien de réinitialisation envoyé après une annulation passe par le quota : si le tiers l'a épuisé juste avant, le titulaire attend le délai croissant (15 minutes au plus, revue du cycle 2, M4, accepté) ;
- changement de mot de passe : avis envoyé à l'adresse du compte (décision de l'utilisateur) ;
- réinitialisation : un échec de Redis ou de la base après la consommation du jeton brûle le lien sans changer le mot de passe ; on en redemande un (accepté) ;
- purge des comptes non vérifiés : toutes les heures, dans le processus (arrêtée en test) ; époque augmentée et compte suspendu dans une transaction, sessions révoquées, puis profils et compte supprimés. Un compte vérifié pendant la purge est seulement déconnecté une fois ;
- les liens envoyés par e-mail visent `/auth/verify-email`, `/auth/reset-password` et `/auth/cancel-email-change` du web (jeton dans le fragment), pages à écrire en tranche 7 avec `Referrer-Policy: no-referrer` ;
- service des fuites sans réponse en 3 s : mot de passe accepté, compteur `wishlist.password_breach_check_unavailable` (écrit dans AUTH-02).

Suites :

- Renvoi du lien de vérification : aucune route ; un compte qui n'a pas reçu le lien passe par la réinitialisation (qui vérifie l'adresse). À ajouter si l'usage le demande.
- Sélection d'office du profil unique à la connexion (PRO-04) : tranche 5, avec `POST /session/profile`.
- Revue `security-reviewer` du 2026-11-13 (cycle 1) : visa refusé. B1, B2, I1, I2, I3 corrigés (I3 et le point M1 par décision de l'utilisateur), M5 (lecture bornée de la réponse du service des fuites), M6 (sessions expirées masquées), M7 (non-fuite étendue au changement d'e-mail, à l'annulation, à la ré-authentification, au changement de mot de passe et à la révocation). M2 et M3 acceptés (ci-dessus) ; M4 réduit par la réservation de l'adresse.
- Revue `security-reviewer` du 2026-11-13 (cycle 2) : B1, B2, I1 à I3 confirmés corrigés ; visa refusé pour C2-B1 (lien de vérification ouvrant une session), corrigé en retirant la session. M1 et M2 corrigés (annulation tout ou rien) ; M3 et M4 acceptés.
- Revue `security-reviewer` du 2026-11-13 (cycle 3) : **visa SEC-40 accordé**. C3-M1 corrigé (violation d'unicité d'une requête brute, `P2010` / `23505`, reconnue comme adresse prise) ; C3-M2 en suite (ci-dessous) ; C3-M3 accepté (une annulation sur une adresse reprise déconnecte tout le compte ; seul l'ancien titulaire peut la provoquer).
- Tranche 7, page `/auth/verify-email` : dire « Vous n'avez pas créé ce compte ou ne connaissez pas son mot de passe ? Réinitialisez-le », avec un lien direct (revue du cycle 3, C3-M2 : un proche qui a inscrit l'adresse d'un autre peut s'y connecter une fois l'adresse vérifiée, tant que le titulaire n'a pas réinitialisé).

**Tranche 3 faite le 2026-11-13** (opus). Routes `POST /auth/totp/enroll`, `/auth/totp/activate`, `/auth/totp/verify` (publique), `/auth/totp/disable`, `/auth/recovery-codes`, `GET /account`, `GET /trusted-devices`, `DELETE /trusted-devices/{id}` ; `POST /auth/reauth` accepte un code ; `GET /session` et `POST /auth/login` disent `secondFactorPending` ; migration `20261113200000_second_factor` (`account.totp_last_step`, `recovery_code.code_hash` en SHA-256 unique par compte) ; ports `SecretCipher` (AES-256-GCM), `TotpEngine` (`otplib` 13.5.0, ADR 0003), `SecondFactorRepository`, `TrustedDeviceRepository`, `PendingSecondFactors` (Redis) ; variable `SECRET_ENCRYPTION_KEYS` (trousseau, identifiant 0 refusé en production) ; règles précisées dans AUTH-10 à AUTH-14 et SEC-22 ; test OBS-26 étendu au secret TOTP, aux codes de secours et aux jetons de pré-authentification et d'appareil. Le refus en échec fermé (`503`) des comptes à TOTP de la tranche 2 est retiré. Choix faits dans les silences, à relire :

- **compte `ADMIN` ou `MODERATOR` sans TOTP : connexion refusée** (`403 TOTP_ENROLLMENT_REQUIRED`), plutôt qu'une session restreinte à l'inscription ; le TOTP s'active avant l'attribution du rôle (à faire respecter par le changement de rôle de la phase 7). Ces comptes ne désactivent pas leur TOTP, et un appareil de confiance ne les dispense jamais du code ;
- secret en attente gardé en base (`totp_secret_enc` sans `totp_enabled_at`) ; une nouvelle inscription le remplace, et l'activation n'aboutit que si le secret vérifié est toujours celui en attente (deux onglets) ;
- anti-rejeu par **dernier pas accepté** en base (`UPDATE … WHERE totp_last_step < pas`) plutôt que par marque Redis : il refuse aussi un code plus ancien que le dernier accepté, et ne dépend pas de Redis ;
- codes de secours de **80 bits en SHA-256** (pas argon2) : même raisonnement que les jetons de session (ADR 0013) ; acceptés aussi à la ré-authentification, sinon un utilisateur qui a perdu son téléphone ne pourrait pas désactiver le TOTP ;
- un code faux **n'efface pas** la pré-authentification (le compteur par compte suffit, et l'utilisateur ne retape pas son mot de passe à chaque faute de frappe) ; au succès, elle est consommée par `GETDEL` : une seule session en sort ;
- la ré-authentification avec TOTP compte un code faux sur `reauth` **et** `second_factor` (elle n'ouvre pas un second chemin pour essayer des codes) ; un mot de passe faux sur `reauth` seulement (revue du cycle 1, M1 : sinon qui tient la session sans le mot de passe retarderait les connexions du titulaire) ; sans code alors que le TOTP est actif, `422 SECOND_FACTOR_REQUIRED` avant tout essai (le titulaire de la session le sait déjà) ;
- l'activation compte ses codes faux sur `second_factor` (sans avertissement : c'est le titulaire de la session qui saisit le code de son propre secret) ; **elle révoque toutes les sessions** et rend une session neuve à l'appelant (revue du cycle 1, I2, décision de l'utilisateur). Le secret en attente est revérifié juste avant le changement d'époque : un double onglet ne déconnecte personne pour rien, sauf dans une fenêtre de quelques millisecondes ;
- second facteur : délai plafonné à **une heure** et **avertissement par e-mail** au premier franchissement du seuil dans la fenêtre de 24 h, par `EventThrottle` (revue du cycle 1, I1, décision de l'utilisateur ; risque d'une attaque par un tiers qui connaît le mot de passe ramené d'environ 10 % à 2,6 % par an, et le titulaire est prévenu). `RateLimiter.recordFailure` renvoie désormais le nombre d'échecs dans la fenêtre ;
- **révoquer un appareil de confiance révoque les sessions ouvertes grâce à lui** (appareil perdu ou prêté) ; désactiver le TOTP révoque tous les appareils (sinon ils dispenseraient d'un TOTP réactivé plus tard) ;
- l'appareil de confiance est créé avant la session ; si la création de la session échoue, il est révoqué ;
- le seuil de 50 échecs par compte depuis un appareil de confiance (ADR 0013) n'est accordé que si le cookie désigne un appareil actif **du compte dont l'e-mail est saisi** ;
- avis par e-mail à l'activation, à la désactivation et à chaque usage d'un code de secours (y compris à la ré-authentification) ;
- `GET /account` ajouté maintenant (métadonnées seulement, forme figée par un test) : le client doit savoir si la ré-authentification demande un code ;
- cookie `__Host-lh_pending` en `SameSite=Strict`, `Max-Age` de 5 minutes ; `__Host-lh_device` en `SameSite=Lax` (ADR 0013), 30 jours ;
- otplib omet de l'URI `otpauth://` les valeurs par défaut (SHA-1, 6 chiffres, 30 s), que toutes les applications supposent.

Suites :

- Tranche 4 : TOTP après Google (AUTH-12) par la même pré-authentification ; ré-authentification par Google plus code.
- Tranche 7 : écrans d'activation (QR code dessiné par le client, sans service tiers), de saisie du code avec « faire confiance à cet appareil », des codes de secours (affichés une fois, à copier ou imprimer), des appareils de confiance ; rappel du TOTP à la création du deuxième profil (AUTH-13).
- Phase 7 : le changement de rôle vers `ADMIN` ou `MODERATOR` exige un TOTP actif ; réinitialisation du TOTP d'un compte par un administrateur (`11`, procédure vérifiée).
- Rotation du trousseau : procédure de re-chiffrement des secrets vers la nouvelle clé avant de retirer l'ancienne, à écrire avec le premier serveur. D'ici là, retirer une clé du trousseau ferme le TOTP des comptes concernés (`500`) (revue du cycle 1, M7).
- Revue `security-reviewer` du 2026-11-13 (cycle 1) : **visa SEC-40 accordé**. I1 et I2 corrigés (ci-dessus). M1 corrigé (un mot de passe faux à la ré-authentification ne compte plus sur `second_factor`). M4 en partie : tests ajoutés pour l'appareil de confiance après réinitialisation (contrat et intégration) et pour la pré-authentification invalidée par la désactivation ; le seuil de 50 refusé avec l'appareil d'un autre compte n'est pas testé (le compteur du couple, à 5, se déclenche avant dans les tests de contrat), à couvrir en tranche 8. Acceptés : M2 (deux bons codes envoyés en même temps, le second est consommé pour rien), M3 (un seul cookie d'appareil par navigateur ; deux comptes sur le même navigateur se l'écrasent, à dire en tranche 7), M5 (une à deux lectures en base avant la limitation quand un cookie d'appareil est présenté). Pour la tranche 7 : M6 (agent utilisateur des appareils affiché en texte, jamais en HTML).
- Revue `security-reviewer` du 2026-11-13 (cycle 2, dernier) : **visa SEC-40 maintenu**, aucun point bloquant ni important. N1 corrigé (double envoi de l'activation : refus `409` avant le changement d'époque si le TOTP est déjà actif). N3 corrigé (la réinitialisation confirmée vide le compteur `second_factor`, nouvelle méthode `RateLimiter.clear`). N4 corrigé en partie : tests Redis du plafond par portée, des compteurs renvoyés par `FAIL` et de `clear` ; avertissement depuis la ré-authentification. N5 corrigé (spec : avertissement une fois par fenêtre de 24 h, pas pour l'activation). Acceptés : N2 (pendant le délai du second facteur, la ré-authentification répond `429` à un mot de passe juste et `401` à un faux ; ne sert qu'à qui tient déjà la session, pendant qu'un tiers fait échouer des codes ; la réservation `reauth` expire alors seule en 10 s), N6 (l'avertissement n'est pas renouvelé dans les 24 h même après un succès du titulaire) ; la course de l'activation remplacée pendant la transaction reste couverte par lecture seulement.

**Tranche 4 faite le 2026-11-13** (opus). Routes `POST /auth/google/start` (publique), `GET /auth/google/callback` (publique, `@OidcCallback()`, hors du contrat OpenAPI), `POST /auth/google/link`, `POST /auth/google/reauth`, `DELETE /auth/google` ; `POST /auth/reauth` accepte un code sans mot de passe après un retour de Google ; `GET /account` dit `googleLinked` ; migration `20261113220000_google_identity` (une identité Google par compte, forme du `sub`) ; `openid-client` 6.8.8 (ESM chargé par `require`, Node 22) ; ports `GoogleOidc`, `OidcFlows` et `GoogleReauthProofs` (Redis), `GoogleIdentityRepository` ; `SignInCompletion`, fin de connexion commune au mot de passe et à Google (TOTP, appareil de confiance, AUTH-13) ; variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (facultatives, ensemble), `GOOGLE_OIDC_ISSUER` (`https:` exigé en production) ; règles précisées dans AUTH-03, AUTH-05, AUTH-09, AUTH-14, `01` « Limitation », `12`, `13` ; tests de l'adaptateur contre un fournisseur OIDC local (`test/support/fake-oidc-provider.ts`), contrat, intégration, non-fuite (OBS-26 étendu à `code`, `state`, `nonce`, PKCE, secret du client, `sub`, adresse Google). Choix faits dans les silences, à relire :

- **jamais de fusion, même sur adresse vérifiée des deux côtés** (`GOOGLE_LINK_REQUIRED`) : l'association se fait seulement depuis l'espace Compte ; seul un compte non vérifié est remplacé (AUTH-15) ;
- **association et dissociation après ré-authentification** (ajoutées à AUTH-14) : sinon un proche devant une session ouverte associerait son propre Google et garderait un accès durable. Avis par e-mail aux deux ;
- **dissociation** seulement avec un mot de passe ; elle change l'époque (toutes les sessions tombent, y compris celles ouvertes par Google), session neuve pour l'appelant ; conditions vérifiées avant le changement d'époque, puis dans la transaction ;
- **une réinitialisation du mot de passe ne dissocie pas Google** : un compte créé par Google se donne un mot de passe par elle, et la perdre à chaque fois serait absurde. Un proche qui aurait associé son Google s'évince par : réinitialisation, connexion, ré-authentification, dissociation (l'avis d'association le dit) ;
- **inscription par Google** : déclaration d'âge et nom du premier profil saisis avant le départ et gardés dans l'état du parcours (Redis, 10 minutes) ; sans eux, `GOOGLE_REGISTRATION_REQUIRED` et rien n'est créé. Portées `openid email` seules : ni nom ni photo demandés à Google ;
- **ré-authentification par Google** : `max_age=0` et `auth_time` de moins de 5 minutes exigés, même `sub` que l'identité associée. Avec le TOTP, une preuve liée au jeton courant et à l'époque attend le code 5 minutes ; lue sans être consommée (un code mal tapé ne fait pas repasser par Google), consommée au succès ;
- parcours de connexion lié au **hash de la pré-session** ; un départ depuis une session sans pré-session en tire une (cookie seul, le jeton CSRF reste celui de la session). Association et ré-authentification liées à `session.id`, au compte et à l'époque ;
- `state` consommé (`GETDEL`) **avant** la vérification du lien au navigateur : un retour présenté par un autre navigateur brûle le parcours ;
- connexion par Google : identité lue, puis époque, puis identité relue (ADR 0014) : une dissociation concurrente ne laisse pas ouvrir de session ;
- retour : redirection `303` vers `/auth/google/return?status=…` ou `?error=<code>` du web (page de la tranche 7), `no-store`, `Referrer-Policy: no-referrer` ; une erreur métier devient un code dans l'adresse, toute autre erreur suit le chemin ordinaire (500, rapport nettoyé) ;
- démarrages limités à **30 par heure et par IP** (`oidc_ip`) : chaque démarrage occupe Redis, en `noeviction` ;
- le jeton d'identité vient du point de terminaison de Google par TLS : sa signature n'est pas vérifiée par `openid-client` 6 (OIDC Core 3.1.3.7 le permet) ; aucun jeton Google n'est conservé ;
- association en une seule instruction (`INSERT … SELECT` sur un compte actif et vérifié), les deux index d'unicité tranchent les concurrences ;
- `AUTH-09` : en `INVITE_ONLY`, l'inscription par Google est refusée (`INVITATION_REQUIRED`) jusqu'aux invitations de la tranche 6 ; un compte associé se connecte toujours.

Suites :

- **À vérifier contre le vrai Google avant la mise en production** : que `max_age=0` force bien une nouvelle authentification et renvoie `auth_time` (sinon la ré-authentification par Google échoue toujours, en échec fermé), et que `iss` vaut `https://accounts.google.com` et non `accounts.google.com` (sinon tout retour est refusé ; revue M9).
- Revue `security-reviewer` du 2026-11-13 (cycle 1) : **visa SEC-40 accordé**, aucun point bloquant. Corrigés :
  - I1 : un `state` inconnu n'écrit plus au journal de sécurité, et les retours refusés y vont une fois par minute et par (adresse, compte), par `EventThrottle` ;
  - I2 : l'association exige encore la ré-authentification au retour de Google (verrouillage ou changement de profil entre les deux : `REAUTH_REQUIRED`, rien d'associé) ;
  - I3, en partie : `prompt=select_account` sur tous les parcours ;
  - M1 : fraîcheur mesurée au départ du parcours (`auth_time` remonté de l'adaptateur) ;
  - M2 : AUTH-03 précisé, l'adresse Google ne sert qu'à créer un compte ;
  - M3 : émetteur `https://accounts.google.com` imposé en production ;
  - M4 : forme de l'adresse Google contrôlée ;
  - M6 : preuve de ré-authentification Google effacée au verrouillage et au changement de profil.
  
  Restent :
  - I3, autre partie : adresse Google masquée dans l'avis d'association. Elle est écartée pour l'instant : les e-mails du compte ne portent aucune adresse, et cet indice serait à conserver pour l'espace Compte. À arbitrer avec RGPD-02 ;
  - M5 (accepté) : une dissociation qui voit le mot de passe disparaître en concurrence déconnecte l'appelant, en échec fermé, conformément à l'ADR 0014 ;
  - M7 : un 500 forcé sur le retour Google n'est pas encore couvert par la non-fuite (le filtre `url.query` s'applique déjà à toutes les routes), à ajouter en tranche 8 ;
  - M8 (disponibilité seulement) : une erreur réseau emballée sans réponse serait classée `GOOGLE_REJECTED` plutôt qu'indisponible.
- Revue `security-reviewer` du 2026-11-13 (cycle 2, dernier) : **visa SEC-40 maintenu**, aucun point bloquant ni important pour la tranche. Restes du cycle 1 jugés acceptables, M9 à condition que la vérification contre le vrai Google bloque la mise en production.
  - Corrigés :
    - I-C2-1 (latent avant la tranche 5) : la preuve Google est effacée **avant** le verrouillage ou le changement de profil, pour qu'une panne de Redis n'écrive jamais le changement sans publier son événement (salons temps réel, VIS-20) ;
    - C2-M1 : test de contrat d'une authentification Google antérieure au départ du parcours.
  - Restent :
    - C2-M2 : la limitation des lignes `google.rejected` n'est pas testée (le double `InMemoryEventThrottle` laisse tout passer ; à couvrir en tranche 8 avec un double qui compte) ;
    - C2-M3 (accepté) : un verrouillage qui tombe entre la lecture de l'époque et la création de la preuve la laisse survivre, quelques millisecondes, le code TOTP restant exigé ;
    - tranche 7 : dire sur la page de retour qu'une association qui dépasse la ré-authentification de 10 minutes demande de recommencer.
- Tranche 6 : jeton d'invitation porté par l'état du parcours Google et consommé à la création du compte (AUTH-09).
- Tranche 7 : page `/auth/google/return` (issue, code d'erreur, suite : second facteur, code de ré-authentification, inscription proposée sur `GOOGLE_REGISTRATION_REQUIRED`, connexion par mot de passe sur `GOOGLE_LINK_REQUIRED`) ; case d'âge et nom avant « S'inscrire avec Google » ; Google dans l'espace Compte.
- Déploiement : client OAuth « Application Web » chez Google, URI de redirection `<WEB_ORIGIN>/api/v1/auth/google/callback` ; Google au registre des sous-traitants (RGPD-03, déjà écrit).

**Tranche 5 faite le 2026-11-13** (opus). Routes `POST /session/profile`, `POST /session/lock`, `GET/PATCH /profiles/me`, `PUT /profiles/me/pin`, `GET/POST /account/profiles`, `DELETE /account/profiles/{id}`, `PUT /account/profiles/{id}/pin/reset`, `DELETE /account/profiles/{id}/pin` ; port `ProfileRepository` (Prisma, double en mémoire partageant le magasin des comptes et des réglages de verrouillage) ; `PinVerifier` commun à la sélection et au changement de PIN ; sélection d'office du profil unique dans `SessionLifecycle.create` (PRO-04, tous moyens de connexion) ; cookie `__Host-lh_unlock` (`EVERY_OPEN`) ; métrique `wishlist.authorization_denied` (tâche 8 de la phase 0 bis, comptée par le filtre d'erreurs pour les natures `unauthenticated`, `forbidden`, `locked` et les codes `PIN_INVALID`, `PIN_RATE_LIMITED`) ; événements `pin.*` et `profile.*` au journal de sécurité ; règles PRO-03, PRO-04, PRO-07, PRO-08, PIN-03 à PIN-05, PIN-07 précisées dans `01`, codes dans API-13 ; test OBS-26 étendu aux PIN (cherchés isolés), au hash du PIN, à son empreinte, au nonce de déverrouillage. Une migration : `20261114090000_pin_failures_since_entry` (les autres colonnes existaient). Choix faits dans les silences, à relire :

- **attente de PIN-03 par profil, en base**, pas dans le limiteur Redis : 1, 5, 15 minutes puis une heure au plus. L'essai est compté **avant** d'être évalué, par un seul `UPDATE … RETURNING` conditionnel qui pose aussi l'attente suivante : une rafale parallèle ne passe pas le seuil (test d'intégration à 12 essais), puis un seul essai par attente. Un PIN juste ne remet le compteur à zéro que si le hash est toujours celui vérifié. Un proche peut retarder un profil d'une heure au plus : accepté, le titulaire du compte réinitialise ;
- **e-mail au compte à la 5ᵉ erreur seulement** (par le quota d'envoi), sans nom de profil ; une ligne `pin.locked` à chaque attente posée ;
- **sélection** : le profil choisi devient actif avant la vérification du PIN (l'ancien est verrouillé, la ré-authentification effacée même si le PIN est faux) ; même route pour redéverrouiller après inactivité ; pas de route `/session/unlock` ;
- **notice de réinitialisation** (`pin_reset_notice_at`), posée par la réinitialisation et la désactivation, rendue à **chaque** entrée et par `GET /profiles/me`, **effacée seulement quand le profil se redonne un PIN** (PIN-04) : celui qui a réinitialisé pour entrer ne peut pas la faire disparaître (revue SEC-40, B1). Un profil qui ne veut plus de PIN la voit jusqu'à ce qu'il en reprenne un : accepté ;
- **déverrouillage lié au PIN** : il porte l'empreinte (SHA-256) du hash du PIN qui l'a donné, comparée à celle du PIN courant par la garde ; un PIN changé ou réinitialisé rend sans effet tout déverrouillage d'avant, même écrit après (revue SEC-40, I2). Un cache d'avant la tranche (sans empreinte) est verrouillé ;
- **PIN faux depuis la dernière entrée** rendus au profil à chaque entrée par PIN (`failedPinAttempts`, revue SEC-40, I3) ;
- **affaiblir `pin_relock`** exige le PIN courant (revue SEC-40, M1) ;
- **réinitialiser un PIN** = fixer un nouveau PIN depuis l'espace Compte (refusé sur un profil sans PIN, `PIN_NOT_SET`) ; le profil est verrouillé dans toutes les sessions où il est actif, celle de l'appelant comprise. Changer son PIN (PIN-04) verrouille les autres sessions du profil, pas la sienne ;
- **marqueur enfant fixé à la création** : `PATCH /profiles/me` le refuse (champ inconnu, `400`) ; aucune route ne le change ensuite (à décider avec PRO-05, tranche 6) ;
- **suppression de profil définitive** (aucune donnée ne le référence encore) ; PRO-06 (corbeille, « Profil supprimé ») s'appliquera en phase 2. Les sessions où il est actif sont lues **avant** la suppression (la clé étrangère `SET NULL` les efface des lignes), puis désélectionnées (cache, ré-authentification, événement) ; supprimer le profil actif de l'appelant efface donc sa ré-authentification (revue SEC-40, I1). Une session qui le choisirait entre la lecture et la suppression n'est pas désélectionnée dans le cache : elle n'y trouve qu'un profil absent (`423`), sans événement ;
- passer à `EVERY_OPEN` verrouille la session courante à la requête suivante (son déverrouillage n'a pas de nonce) : le PIN est redemandé, comme à une ouverture ;
- `412` sans l'état courant (le client relit `GET /profiles/me`, `ETag`) ; `If-Match` exigé, sinon `400` ; `Idempotency-Key` pas encore pris en charge (aucune infrastructure commune).

Suites :

- Revue `security-reviewer` du 2026-11-13 (cycle 1) : visa refusé pour B1 (notice consommée par celui qui a réinitialisé), corrigé. Corrigés aussi : I1, I2, I4 (non-fuite étendue au seuil de PIN-03, au `429`, à l'e-mail, au changement par l'ancien PIN, à la désactivation), M1, M2 (profil supprimé pendant la sélection : `404`, pas `500`), M4 (`429 PIN_RATE_LIMITED`, compté dans `wishlist.authorization_denied`). I3 en partie : le profil voit les essais faux à son entrée ; **à décider** : un second compteur sur fenêtre longue qu'un PIN juste ne vide pas (aujourd'hui, chaque entrée du titulaire rend 5 essais à un proche, soit 40 à 50 essais par jour avec le plafond d'une heure : un PIN de 4 chiffres tient quelques mois), et le refus des PIN triviaux. Acceptés : M3 (profil qui reçoit un PIN pendant la sélection annoncé déverrouillé, la garde répond `423`), M5 (attente calculée avec l'horloge de l'API, une seule instance), M6 (voir I3), M7 (le journal ne nomme pas le profil visé, à voir avec l'écran de la tranche 7).
- Revue `security-reviewer` du 2026-11-13 (cycle 2, dernier) : **visa SEC-40 accordé**, aucun point bloquant ; B1, I1, I2, I4, M1, M2, M4 confirmés corrigés. I3 (fenêtre longue, PIN triviaux) : **non retenu, décision de l'utilisateur** (casser un PIN par un script pour connaître une surprise relève du roman d'espionnage), écrit comme limite assumée dans PIN-03. Mineurs du cycle, corrigés à la demande de l'utilisateur :
  - C2-M1 : colonne `pin_failures_since_entry` (migration `20261114090000_pin_failures_since_entry`), augmentée avec chaque essai compté, diminuée de l'essai juste, effacée seulement par l'entrée qui la montre (`takeFailuresSinceEntry`) : changer son PIN ou affaiblir `pin_relock` ne la perd plus ;
  - C2-M2 : l'empreinte vient du seul adaptateur (`pinStampOf`), rendue par `countPinAttempt` et `setPin` ; `SecretTokens.hash` n'y sert plus ;
  - C2-M3 : l'empreinte est cherchée par le test de non-fuite.
  
  Acceptés : C2-M4 (phase 4 : session qui choisit un profil pendant sa suppression, sans événement), C2-M5 (affaiblissement de `pin_relock` validé par l'ancien PIN pendant une réinitialisation concurrente ; le déverrouillage tombe par l'empreinte).
- Tranche 7 : l'écran doit afficher la notice de réinitialisation et `failedPinAttempts`, sans quoi B1 et I3 restent sans effet pour le titulaire.
- Phase 2 : suppression de profil conforme à PRO-06 (corbeille de 30 jours, participations et commentaires gardés sous « Profil supprimé ») ; avatar par image.
- Tranche 6 : changer le marqueur enfant depuis l'espace Compte (avec ré-authentification ?), à décider avec PRO-05.
- Tranche 7 : écran de saisie du PIN (attente annoncée par `Retry-After`), affichage de la notice de réinitialisation, rappel de PIN-06 quand un profil sans PIN cache un élément, `POST /session/lock` au lancement ; textes d'erreur `PIN_INVALID`, `CURRENT_PIN_REQUIRED`, `PIN_NOT_SET`, `LAST_PROFILE`, `PROFILE_LIMIT_REACHED`.
- Phase 4 : notification aux autres profils du compte (PIN-03) à la place de l'e-mail.

Sortie : critères d'acceptation de `01` ; revue `security-reviewer` sans point bloquant.

## Phase 2 — Articles, listes, visibilité

Spec : `02`, `03`, `04`. ADR 0004, 0007.

| Tâche | Modèle |
|---|---|
| **Moteur de visibilité** : types de vues, règles, matrice de tests générée (écrite avant le code) | opus |
| Service `fetcher` isolé et protections SSRF | opus |
| Extraction : données structurées, port `ProductExtractor`, adaptateur Claude, validation, brouillon | opus (port, prompt, validation), sonnet (analyseurs) |
| Fiches article, listes, éléments, rôles de liste, succession | sonnet, revue opus |
| Règles de visibilité par élément, journal des changements | opus |
| Écrans : listes, ajout par lien, photo, saisie, composant « Qui voit ça ? » | sonnet |
| Répertoire du cercle, fenêtre de publication (REP-06) | sonnet, revue opus |
| Jeu de pages figées et mesure de l'extraction | sonnet |

Sortie : matrice de visibilité verte ; tests de non-fuite sur toutes les routes de lecture ; tests SSRF verts.

## Phase 3 — Événements et giftlists

Spec : `03` (giftlists), `05`.

| Tâche | Modèle |
|---|---|
| Giftlists : exposition, absence de trace (GFT-07), tests de non-fuite | opus |
| Événements, invitations, réponses, audience | sonnet, revue opus |
| Reprise des souhaits non obtenus (EVT-22), événements surprise | opus |
| Assistant de réponse en trois étapes, pages d'événement | sonnet |
| Confirmation de réception (vue offreur bleu et vert, vue destinataire neutre et vert) | sonnet, revue opus |

Sortie : critères de `05` ; le destinataire d'une giftlist cachée ne peut rien observer.

## Phase 4 — Commentaires, notifications, temps réel

Spec : `06`. ADR 0006.

| Tâche | Modèle |
|---|---|
| Passerelle temps réel, salons, vérification d'abonnement, rattrapage | opus |
| Deux fils de commentaires, dépôts distincts, activité | opus |
| Notifications : génération par destinataire à travers le moteur de visibilité | opus |
| Web Push, résumé e-mail, préférences, heures calmes | sonnet |
| Écrans : fils, centre de notifications, présence | sonnet |
| Tests à deux clients (QA-13) | sonnet, cas écrits par opus |

Sortie : aucun événement d'offreur dans les trames d'un destinataire, sur tous les salons.

## Phase 5 — Compta

Spec : `07`.

| Tâche | Modèle |
|---|---|
| Domaine : participations, arrondis, journal, tests par propriétés | opus |
| Concurrence sur le reste, idempotence | opus |
| Acheteur, panier, achat, règlements | sonnet, revue opus |
| Écart de prix (CPT-16 à CPT-19) : répartition, reste à couvrir, notification sélective | opus |
| Soldes, compensation, budgets | sonnet, revue opus |
| Vue latérale, panier, comptes, animations associées | sonnet |

Sortie : critères de `07` ; le journal permet de reconstituer tout état.

## Phase 6 — Hors ligne, installation, motion

Spec : `08`, `10`. ADR 0005.

| Tâche | Modèle |
|---|---|
| Conception du cache cloisonné et chiffré, file de mutations, purge | opus |
| Service worker, persistance, rejeu, écran des actions non synchronisées | sonnet, revue opus |
| Résolution de conflits | sonnet |
| Manifeste, cible de partage, installation, pastille | sonnet |
| Passe de motion design sur tous les moments de `10`, mouvement réduit | sonnet |
| Audit d'accessibilité et corrections | sonnet |
| Tests de bout en bout hors ligne | sonnet |

Sortie : critères de `08` ; Lighthouse ≥ 90 ; les six parcours clés tenus.

## Phase 7 — Administration, catalogue global, mise en production

Spec : `11`, `14`. ADR 0008.

| Tâche | Modèle |
|---|---|
| Espace d'administration, permissions, journal d'audit | opus |
| Catalogue global, modération, signalements | sonnet, revue opus |
| Export et suppression des données | opus |
| Production : Compose, Caddy, sauvegardes, restauration testée, observabilité, alertes | sonnet, revue opus |
| Trivy sur chaque image construite avant publication ; rapport hebdomadaire planifié des images tierces (CI-05) | sonnet |
| Revue de sécurité complète et test d'intrusion ciblé sur la surprise (SEC-42) | opus |

Sortie : restauration réussie et chronométrée ; aucune fuite trouvée ; ouverture sur invitation.

## Après la v1

Dans l'ordre proposé, sous réserve de vos choix dans `15-suggestions.md` : groupes nommés, tirage au sort, passkeys, rappels d'anniversaire, historique des cadeaux, lien invité.

## Méthode de travail pour chaque phase

1. **Opus, mode plan** : relire les fichiers de spec de la phase, lever les questions ouvertes avec vous, découper en tâches petites et indépendantes, écrire les tests de non-fuite attendus.
2. **Sonnet** : implémenter tâche par tâche, tests compris.
3. **Opus** : `/security-review` et agent `security-reviewer` sur ce qui est sensible, `/code-review` sur le reste.
4. Mettre à jour la spec si une décision a changé, avant de fusionner.

**Git** (décidé le 2026-11-13, à partir de la phase 1) : une branche par phase (`feat/phase-N`) partie d'un `main` à jour, et une PR en brouillon ouverte dès le début pour que la CI tourne à chaque envoi. Les commits d'une tranche sont poussés ensemble à la fin de la tranche, pour qu'un échec de la CI ne concerne que la dernière ; une tranche sensible est relue par `security-reviewer` sur le diff `origin/feat/phase-N..HEAD` avant cet envoi. La tranche est cochée dans la description de la PR, qui passe « prête » à la fin de la phase.
