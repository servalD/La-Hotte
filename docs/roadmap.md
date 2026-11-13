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
| 6 | CI et déploiement : build avec cartes, `glitchtip-cli` compilée depuis crates.io `--locked` (OBS-35) pour `inject`, script `ops/observability/bundle-sourcemaps` pour le bundle et l'envoi (OBS-31, le `upload` de la CLI 1.0.0 est cassé), vérification côté serveur (OBS-34), au déploiement seulement, suppression des cartes de l'artefact servi, release = SHA | opus (script et vérification), sonnet (CI) |
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
- Pas d'erreur du navigateur provoquée de bout en bout dans un vrai navigateur : à faire avec la tâche 6 (cartes et pile lisible, OBS-34).

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

Spec : `01`, `09`. ADR 0003, ADR 0011 (essai de Better Auth fait le 2026-11-12 : voie maison retenue).

| Tâche | Modèle |
|---|---|
| Découpage de la phase, modèle de session, essai rapide d'une bibliothèque d'authentification (ADR 0003) | opus |
| Inscription, vérification d'e-mail, connexion, sessions, révocation, limitation | opus |
| Google OIDC + PKCE, association de compte | opus |
| TOTP, codes de secours, ré-authentification | opus |
| Profils, sélection, PIN serveur, verrouillage | opus |
| Liens, cercle, invitations, blocage | sonnet, revue opus |
| Écrans : inscription, connexion, sélecteur de profil, réglages, sessions | sonnet |
| Tests de sécurité : énumération, CSRF, routes sans session | opus |

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
