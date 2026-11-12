# 14 — Qualité, tests et déploiement

## Objectif

Définir ce qui doit être vrai avant qu'un changement soit fusionné, et comment le service est mis en ligne et surveillé.

## Architecture du code

- **QA-01** Monorepo pnpm + Turborepo.

```
apps/
  api/            NestJS
  web/            Next.js (App Router)
packages/
  api-client/     généré depuis openapi.json (+ schémas temps réel écrits à la main)
  config/         tsconfig, eslint, prettier partagés
docs/
  spec/  adr/  roadmap.md
```

- **QA-02** `apps/api` suit une architecture propre, un dossier par module métier (`identity`, `catalog`, `lists`, `visibility`, `events`, `accounting`, `conversations`, `notifications`, `directory`, `admin`) :

```
modules/<module>/
  domain/           entités, objets-valeur, règles, ports (interfaces)   → n'importe rien d'extérieur
  application/      cas d'usage, un fichier par cas                       → importe domain
  infrastructure/   Prisma, Redis, HTTP sortant, LLM (implémente les ports) → importe domain, application
  presentation/     contrôleurs, DTO, gateways                            → importe application
```

- **QA-03** Le sens des dépendances est vérifié par une règle de lint qui fait échouer la CI : `domain` n'importe ni NestJS, ni Prisma, ni un autre module autrement que par son interface publique.
- **QA-04** `visibility` est un module de domaine dont dépendent tous les modules de lecture. Aucun autre module ne réimplémente une règle d'accès.
- **QA-05** `apps/web` : composants serveur par défaut, composants client pour l'interactif ; les données passent par les hooks générés ; logique d'écran dans des hooks, pas dans les composants de présentation.
- **QA-06** TypeScript strict partout (`strict`, `noUncheckedIndexedAccess`), pas de `any` sans commentaire justificatif.

## Stratégie de tests

| Niveau | Cible | Outil | Exigence |
|---|---|---|---|
| Unitaire | Domaine et cas d'usage (ports simulés en mémoire) | Vitest | Toutes les règles numérotées de la spec ont au moins un test qui cite leur identifiant |
| **Matrice de visibilité** | Moteur de visibilité | Vitest, cas générés | Toutes les combinaisons de VIS-33 ; bloquant |
| Propriétés | Arrondis et sommes de la compta | fast-check | La somme des parts égale toujours le total ; aucune séquence d'opérations ne dépasse le coût |
| Intégration | Dépôts, transactions, contraintes, concurrence | Vitest + PostgreSQL et Redis réels en conteneurs | Chaque dépôt ; les courses de CPT-03 |
| Contrat | API vue de l'extérieur | Supertest sur l'application montée | Chaque route : cas nominal, non connecté, interdit, validation |
| **Non-fuite** | Réponses et trames reçues par un destinataire | Tests dédiés | Aucun champ ni événement d'offreur, sur toutes les routes et tous les salons |
| Bout en bout | Parcours clés de `10-ux-motion.md` | Playwright (bureau et mobile émulé) | Les six parcours, plus hors ligne et multi-profils en parallèle |
| Accessibilité | Écrans principaux | axe dans Playwright | Zéro violation sérieuse |
| Sécurité | SSRF, injection, en-têtes, routes sans session | Tests dédiés + analyse statique | Les critères de `02` et `09` |
| Extraction | Jeu de pages marchandes enregistrées | Tests sur pages figées | Taux de champs corrects suivi dans le temps ; pas d'appel réel au modèle en CI |

- **QA-10** Les tests de non-fuite sont écrits **avant** la fonctionnalité qu'ils protègent.
- **QA-11** Couverture : 90 % sur `domain` et `application`, 100 % des branches sur le moteur de visibilité et la compta. Pas d'objectif chiffré sur l'interface.
- **QA-12** Un bug corrigé commence par un test qui le reproduit.
- **QA-13** Les tests temps réel utilisent deux clients simultanés (un offreur, un destinataire) et vérifient ce que chacun reçoit **et ne reçoit pas**.

## Intégration continue

- **CI-01** À chaque demande de fusion, étapes bloquantes : installation verrouillée, lint (dont règles d'architecture), typage, tests unitaires et matrice, tests d'intégration, génération du contrat sans différence (API-02), build, audit des dépendances, analyse Trivy (CI-05), détection de secrets.
- **CI-02** Tests de bout en bout sur la branche principale et avant chaque mise en production.
- **CI-03** Aucune fusion directe sur la branche principale. Les changements sensibles (SEC-40) exigent la revue de sécurité.
- **CI-04** Commits conventionnels ; journal des changements généré.
- **CI-05** **Analyse Trivy**, bloquante, sur trois objets :
  - **le dépôt** (`trivy fs`) : vulnérabilités des dépendances (`pnpm-lock.yaml`) et mauvaises configurations (Dockerfile, fichiers de configuration), sévérités `HIGH` et `CRITICAL`, **seulement celles qui ont un correctif disponible** (une vulnérabilité sans correctif ne bloque personne et rend la CI rouge pour rien) ;
  - **chaque image que nous construisons** (`web`, `api`, `worker`, `fetcher`) avant sa publication, mêmes sévérités, même règle (DEP-04) ;
  - **les images tierces** que nous déployons (PostgreSQL, Redis, Caddy, collecteur, OpenObserve, GlitchTip) : rapport hebdomadaire planifié, **non bloquant**, qui ouvre une tâche de mise à jour. Une CVE dans l'image de quelqu'un d'autre n'est pas un défaut de notre changement.

  Les secrets restent l'affaire de gitleaks (CI-01) : Trivy ne les cherche pas, pour ne pas dupliquer les alertes.
- **CI-06** **Exceptions.** Une vulnérabilité acceptée est inscrite dans `.trivyignore.yaml` avec son identifiant, la raison (pourquoi on n'est pas exposé), et une **date d'expiration de 90 jours au plus**. Passé ce délai, l'exception disparaît et la CI échoue de nouveau. Aucune exception n'est ajoutée sans être lue en revue.
- **CI-07** **Chaîne d'approvisionnement de la CI.** En mars 2026, les tags de `aquasecurity/trivy-action` ont été réécrits pour voler des secrets de CI. Règles qui en découlent : toute action tierce est appelée par **commit complet** et jamais par tag ; ce commit est vérifié à la main (signature, appartenance à l'historique du dépôt amont, version publiée) avant d'être adopté ; la version du binaire Trivy est fixée dans le workflow, pas laissée au défaut de l'action ; la montée de version se fait par une demande de fusion dédiée. Les actions `actions/*` de GitHub et les autres actions tierces du workflow (`pnpm/action-setup`, `gitleaks/gitleaks-action`) sont à épingler de la même façon (tâche de la roadmap).

## Environnements et déploiement

- **DEP-01** Trois environnements : local (Docker Compose), préproduction, production. Mêmes images, configuration par variables d'environnement.
- **DEP-02** Production sur un VPS dans l'Union européenne, Docker Compose. Les services d'observabilité (ADR 0012) sont sur un réseau Docker `obs` distinct, que les services applicatifs rejoignent pour envoyer leur télémétrie :

| Service | Rôle | Exposition |
|---|---|---|
| `caddy` | Proxy inverse, TLS automatique, en-têtes de sécurité | 80, 443 |
| `web` | Next.js | interne |
| `api` | NestJS (REST + WebSocket) | interne |
| `worker` | Files BullMQ : notifications, e-mails, rappels | interne |
| `fetcher` | Récupération d'URL et d'images, **réseau isolé**, sortie filtrée (EXT-44) | aucune entrée |
| `postgres` | Données | interne |
| `redis` | Sessions, files, pub/sub | interne |
| `otel-collector` | Reçoit l'OTLP des services, nettoie, exporte vers OpenObserve (OBS-11) | interne |
| `openobserve` | Journaux, métriques, traces (OBS-02, OBS-03) | restreinte (OBS-27) |
| `glitchtip` | Erreurs (OBS-04). Un seul processus sert le HTTP et consomme la file : il n'y a plus de worker séparé depuis GlitchTip 7 (ADR 0012). Valkey/Redis est facultatif et n'est pas déployé | restreinte (OBS-27) |
| `postgres-obs` | Base de GlitchTip, instance séparée de celle de l'application | interne |

- **DEP-03** Conteneurs sans privilèges, système de fichiers en lecture seule quand c'est possible, images minimales, mises à jour de sécurité automatiques de l'hôte, pare-feu ne laissant que 80, 443 et l'accès d'administration par clé.
- **DEP-04** Déploiement : image construite et analysée en CI, migration de base, démarrage, vérification de santé, bascule ; retour arrière par l'image précédente. Les migrations sont compatibles avec la version précédente du code (DAT-07).
- **DEP-05** Sauvegardes : base complète quotidienne + journaux de transactions en continu, chiffrées, copiées hors du serveur, conservées 30 jours ; images sauvegardées de la même façon. Restauration testée chaque mois (SEC-23).
- **DEP-06** Objectifs de reprise : perte de données ≤ 15 minutes, remise en service ≤ 4 heures.

## Observabilité

Décision : `docs/adr/0012-observabilite-auto-hebergee.md`. GlitchTip pour les erreurs, OpenObserve pour journaux, métriques et traces, un collecteur OpenTelemetry entre les applications et OpenObserve. Tout est auto-hébergé dans l'Union européenne.

### Ce qu'on observe

- **OBS-01** Journaux structurés en JSON avec identifiant de requête propagé de bout en bout ; aucune donnée de contenu (SEC-31, OBS-20). Chaque ligne porte `trace_id` et `span_id` quand une trace est active.
- **OBS-02** Métriques : latence et erreurs par route, connexions WebSocket, longueur des files, durée et taux de réussite des extractions, jetons consommés et coût par jour, refus d'autorisation (comptés par `code` stable). Émises par l'application en OpenTelemetry ; les cas d'usage passent par le port `Metrics`, jamais par la bibliothèque.
- **OBS-03** Traces OpenTelemetry sur l'API, le worker, le fetcher et le serveur Next.js, avec propagation `traceparent` de bout en bout. Le navigateur ne produit pas de traces.
- **OBS-04** Erreurs côté client et serveur dans GlitchTip, par les SDK Sentry, avec piles lisibles en TypeScript grâce aux source maps (OBS-30 à OBS-33). GlitchTip ne reçoit ni traces ni journaux.
- **OBS-05** Alertes : indisponibilité, taux d'erreur, file bloquée, sauvegarde échouée, certificat proche de l'expiration, dépassement du budget d'extraction, nouvelle erreur ou régression (GlitchTip). Elles partent par un canal indépendant de l'application (OBS-43).
- **OBS-06** Points de santé : `/health/live`, `/health/ready`.

### Architecture

- **OBS-10** Deux outils, deux rôles, sans recouvrement : GlitchTip regroupe les exceptions et alerte ; OpenObserve stocke et interroge journaux, métriques et traces.
- **OBS-11** Un seul point de sortie : les processus envoient en OTLP au collecteur `otel-collector`, qui exporte vers OpenObserve. Seul le collecteur détient les identifiants d'OpenObserve. Il collecte aussi les métriques de l'hôte, de PostgreSQL, de Redis, de Caddy et des conteneurs.
- **OBS-12** Corrélation : les événements d'erreur portent `trace_id` et `request_id` ; on passe d'une issue GlitchTip à sa trace OpenObserve. Mise en œuvre (essai du 2026-11-12) : OpenTelemetry possède les spans, Sentry ne crée aucun span (`enableOpenTelemetrySetup` reste à faux, pas de `tracesSampleRate`), `Sentry.openTelemetryIntegration()` est activée, **et** un `beforeSend` impose `trace_id` et `span_id` du span OpenTelemetry actif, car le span interne de Sentry l'emporte sinon et l'identifiant ne correspond pas. Le processus démarre avec `node --import ./dist/instrument.js` ; `--require` n'est plus pris en charge par Sentry 11.
- **OBS-13** Nommage : services `wishlist-api`, `wishlist-web`, `wishlist-worker`, `wishlist-fetcher` ; `environment` = `development`, `preview` ou `production` ; `release` = SHA du commit déployé.
- **OBS-14** Désactivée par défaut : sans DSN ni point de terminaison, rien n'est initialisé ni envoyé (développement, tests, CI). Une panne de GlitchTip, du collecteur ou d'OpenObserve ne ralentit ni ne fait échouer aucune requête : envois asynchrones, mis en lot, file bornée, abandon silencieux de ce qui déborde.
- **OBS-15** Échantillonnage des traces : 100 % en préproduction, 10 % en production (réglable par variable d'environnement). Les erreurs sont toujours envoyées à GlitchTip.
- **OBS-16** Rétention : erreurs 90 jours, journaux 30 jours (SEC-33), traces 14 jours, métriques 90 jours. Le journal de sécurité (SEC-30) reste en base de données, pour 12 mois : OpenObserve n'en est pas la source de vérité.
- **OBS-46** Variables de l'API, validées au démarrage, toutes facultatives (OBS-14) : `SENTRY_DSN` (GlitchTip), `OTEL_EXPORTER_OTLP_ENDPOINT` (base OTLP/HTTP du collecteur, sans `/v1/traces`), `DEPLOY_ENVIRONMENT` (`development`, `preview`, `production` ; distinct de `NODE_ENV`, la préproduction tournant en `production`), `RELEASE` (SHA), `TRACES_SAMPLE_RATIO` (OBS-15). Une variable vide vaut une variable absente. Une valeur invalide fait échouer le démarrage en nommant la variable, jamais sa valeur.

### Confidentialité de la télémétrie

C'est ici que le produit diffère : un rapport d'erreur est un canal de sortie comme un autre, et la règle de surprise (VIS-20) s'y applique.

- **OBS-20** SEC-31 vaut pour tout ce qui part vers un outil d'observation : journaux, attributs de spans, étiquettes de métriques, événements d'erreur, fils d'Ariane. Sont interdits : corps de requête et de réponse, en-têtes (cookies, `Authorization`, `Idempotency-Key`), chaîne de requête, valeurs de paramètres SQL, texte de commentaire, titre de liste ou d'article, montants de parts et de participations, noms et adresses e-mail, et **l'URL d'un article** (elle révèle le cadeau).
- **OBS-21** On journalise le gabarit de route (`/items/:id`), jamais l'URL résolue avec sa chaîne de requête. Aucun contexte utilisateur n'est posé sur les erreurs (`dataCollection` fermé, voir OBS-28, pas de `setUser`), et un identifiant de profil n'est jamais associé à une action sur un élément (qui réserve quoi).
- **OBS-22** Le nettoyage se fait à la source, dans un module unique `platform/telemetry/scrub`, appliqué aux événements d'erreur, aux fils d'Ariane, aux attributs de spans et aux sérialiseurs de journaux. Le collecteur ajoute une seconde barrière : un processeur qui supprime les clés interdites.
- **OBS-23** Bases de données : nom de l'opération et durée, jamais le texte d'une requête avec ses valeurs ni ses paramètres.
- **OBS-24** Extraction et fetcher : le nom de domaine seulement, jamais l'URL complète, jamais le contenu d'une page ni la sortie du modèle.
- **OBS-25** Seules les erreurs inattendues sont signalées à GlitchTip : 5xx, exceptions non gérées, échecs de tâches de fond. Les erreurs métier (`DomainError`, 4xx) sont comptées en métrique par `code`, pas signalées. Le message d'une exception n'interpole jamais de donnée d'utilisateur.
- **OBS-26** Test de non-fuite de la télémétrie, bloquant en CI : des marqueurs reconnaissables sont placés dans corps de requête, commentaires, titres, URL d'article et montants ; on provoque des erreurs et des requêtes ; on vérifie qu'aucun marqueur n'apparaît dans les journaux, spans, métriques et événements d'erreur capturés par des exporteurs de test. Les exporteurs sont les vrais, dirigés vers un faux collecteur et un faux GlitchTip : on contrôle ce qui quitte réellement le processus. Chaque canal doit être non vide (une instrumentation qui ne s'applique pas ne donne pas un faux vert), et l'objet transmis à `captureException` est contrôlé lui aussi, comme tout ce que le processus écrit hors du journal (`console`, sortie standard et d'erreur). Les marqueurs entrent aussi par les en-têtes de trace (`tracestate`, `baggage` avec des clés `sentry-*`, `sentry-trace`), et une requête sortante de l'application vérifie que seul `traceparent` est propagé vers un tiers. Les exceptions et rejets non gérés sont provoqués dans un processus lancé par `instrument.ts`, comme en production. Le test tourne dans le job d'intégration de la CI (`pnpm test:leak`), qui dispose d'une vraie base : une requête SQL dont PostgreSQL cite la valeur fautive fait partie des scénarios.
- **OBS-27** Accès : interfaces GlitchTip et OpenObserve réservées à l'exploitation, comptes nominatifs avec TOTP, séparées des rôles de l'application (RBAC-01), non exposées sur le domaine de l'application, restreintes par réseau (liste d'adresses ou VPN).
- **OBS-28** **Configuration du SDK Sentry 11** (essai du 2026-11-12). Les valeurs par défaut de Sentry 11 collectent tout : cookies, en-têtes, corps de requête et de réponse, valeurs SQL, variables locales des piles, adresse IP. `sendDefaultPii` n'existe plus ; on ferme explicitement `dataCollection` dans tous les processus (API, web serveur, navigateur, worker, fetcher) : `userInfo: false`, `cookies: false`, `httpHeaders: false`, `httpBodies: []`, `urlQueryParams: false`, `databaseQueryData: false`, `queues: false`, `stackFrameVariables: false`, `frameContextLines: 0`, `genAI`, `mcp` et `graphQL` à faux. Un test échoue si une de ces clés manque. Les intégrations qui capturent du contenu sont retirées ou nettoyées : `Console` (les `console.log` deviennent des fils d'Ariane), `Http` (URL complète).
- **OBS-29** **Fuites constatées dans les spans** (essai du 2026-11-12). Les instrumentations automatiques posent par défaut : `url.full`, `url.query`, `url.path` (URL résolue), `db.query.text` (texte SQL avec ses valeurs), `exception.message` et `exception.stacktrace` (événement de span), `client.address`, `network.peer.address`, `user_agent.original`, et, sur la ressource, `process.command_args`, `process.executable.path`, `host.name`. `scrub` et le processeur du collecteur retirent ou réécrivent chacun de ces attributs : gabarit de route à la place de l'URL résolue, opération et table à la place du texte SQL, pas d'événement `exception` sur les spans (l'erreur va à GlitchTip). Les erreurs de l'API sont déjà dans GlitchTip, les spans n'ont pas à les répéter. Le contexte de trace venu du client est aussi du texte libre : seul `traceparent` est extrait ; le `tracestate` est écarté dès l'entrée, pour qu'il ne soit ni hérité par les spans ni réinjecté dans les requêtes sortantes vers des tiers, et retiré une seconde fois à l'export du span, de son parent et de ses liens (constaté par le test OBS-26 le 2026-11-12) ; `baggage` et `sentry-trace` ne sont jamais extraits. Le collecteur remet aussi à vide le `trace_state` des spans, pas celui des liens (OTTL n'a pas de contexte pour les liens).
- **OBS-45** **Aucune ligne du message d'une erreur ne passe pour un cadre de pile** (constaté le 2026-11-12, tâche 3 et revue de sécurité). Le message d'une erreur peut tenir sur plusieurs lignes, dont certaines ressemblent à des cadres (Prisma : « Can't reach database server at `hôte:port` ») ; l'analyseur de pile de Sentry prend pour un cadre toute ligne qui contient `at x:ligne:colonne`, et le message sort dans `frames` même quand `value` est retiré. Une erreur Prisma porte aussi la requête et ses paramètres en propriétés. Trois barrières : (1) le SDK ne reçoit jamais l'erreur d'origine : le rapporteur des 5xx comme le gestionnaire des erreurs fatales transmettent une copie réduite au type, au code (s'il a la forme d'un code) et aux cadres, causes comprises (`sanitizeError`) ; (2) par précaution, l'analyseur de pile du SDK ne reçoit que les lignes qui sont des cadres de confiance (`trustedStack`) ; (3) `beforeSend` écarte tout cadre qui n'est pas de confiance. Un cadre de confiance a un nom de fonction fait d'identifiants (pas de texte libre) et un emplacement sous la racine de l'application, sous le `node_modules` du dépôt (en développement) ou dans un module interne de Node (`node:internal/…`) ; un chemin contenant une espace ou `..` est écarté. Risque résiduel accepté : une ligne de message qui cite un chemin absolu de l'application. La découpe de la pile après le message n'est qu'une optimisation : si elle échoue (message modifié après coup), le filtre suffit. Les journaux suivent la même règle : type, code et cadres, jamais le message. Exceptions et rejets non gérés, dès que Sentry est actif ou que `DEPLOY_ENVIRONMENT` n'est pas `development` (une préproduction sans DSN ne doit pas écrire l'erreur brute dans ses journaux) : les intégrations `OnUncaughtException` et `OnUnhandledRejection` du SDK ne sont pas utilisées (elles lui transmettent l'erreur d'origine et, après une première erreur fatale, écrivent la suivante brute sur la sortie d'erreur). Un gestionnaire du processus (`fatal.ts`) écrit pour chaque erreur une ligne de journal nettoyée (une ligne fixe si l'erreur elle-même lève quand on la décrit), envoie la première en copie nettoyée, vide Sentry et OpenTelemetry puis sort en code 1, au plus tard après 3 s ; il ne lève jamais. En développement sans DSN, Node garde son comportement, pile complète, pour le débogage. `debug` du SDK est forcé à faux (`SENTRY_DEBUG` ignorée).

### Source maps et relais navigateur

- **OBS-30** Le navigateur ne reçoit jamais de source maps : générées au build, envoyées à GlitchTip, retirées de ce qui est publié.
- **OBS-31** Deux temps, au déploiement seulement et pas sur les demandes de fusion ; release = SHA du commit. (1) `glitchtip-cli sourcemaps inject` ajoute les identifiants de débogage. (2) Un script du dépôt (`ops/observability/bundle-sourcemaps`) fabrique le bundle zip avec son `manifest.json` (organisation, release, et pour chaque fichier : `url`, `type` `minified_source` ou `source_map`, `headers` `debug-id` et `Sourcemap`), l'envoie par le protocole d'envoi par morceaux de GlitchTip (multipart `file_gzip`, nom du fichier = SHA-1 du zip) puis appelle `POST /api/0/organizations/{org}/releases/{version}/assemble/`. La commande `sourcemaps upload` de `glitchtip-cli` 1.0.0 n'est pas utilisée : elle envoie chaque fichier brut, que le serveur rejette (« not a zip file »), tout en retournant un succès. `sentry-cli` n'est pas utilisé (voir l'ADR 0012). Le script est à supprimer quand une version de la CLI aura été vérifiée de bout en bout (OBS-34). La route historique d'envoi par fichier (`releases/{version}/files/`) répond 405 sur GlitchTip 7.
- **OBS-32** L'API, le worker et le fetcher sont lancés avec `node --enable-source-maps` : les piles envoyées sont déjà en TypeScript, sans dépendre de la résolution par GlitchTip. Leurs cartes restent dans l'image (Node en a besoin à l'exécution) mais ne sont servies à personne. Le chemin absolu des fichiers apparaît dans les piles ; c'est un chemin d'image, jamais un chemin d'utilisateur. L'envoi des cartes de ces processus à GlitchTip (OBS-31) est facultatif.
- **OBS-33** Les erreurs du navigateur transitent par un relais de notre origine, `/monitoring` : route Next écrite par nous, qui n'accepte que les enveloppes destinées à notre projet GlitchTip (liste blanche), avec taille et débit limités. La CSP garde `connect-src 'self'`. Un relais qui accepterait n'importe quelle destination serait un relais ouvert. Comportement vérifié par l'essai : DSN étranger, autre projet ou autre clé → 403 ; corps non JSON ou sans DSN → 400 ; corps au-delà de 200 000 octets → 413 ; autre méthode que POST → 405. Le relais ne retransmet ni en-têtes ni adresse du navigateur, seulement le corps, vers une destination fixe. Chaque cas est un test.
- **OBS-34** **L'envoi des cartes se vérifie côté serveur.** L'assemblage est asynchrone : l'envoi peut réussir et le serveur rejeter ensuite le bundle. Après l'envoi, le déploiement interroge GlitchTip (fichiers de la release) et échoue s'il n'y trouve pas les cartes attendues. Un test de bout en bout provoque une erreur dans un build de préproduction et vérifie qu'elle apparaît avec un fichier et une ligne TypeScript.
- **OBS-35** **Chaîne d'approvisionnement de la CLI.** `glitchtip-cli` n'a pas de binaire signé ni de somme de contrôle publiée (artefact de CI GitLab). Elle est compilée depuis crates.io (`cargo install glitchtip-cli --locked --version <fixée>`) dans la CI, comme CI-07 le demande pour tout outil tiers ; la version est fixée et sa montée de version passe par une demande de fusion dédiée. Elle refuse d'envoyer vers un hôte différent de l'URL configurée : `GLITCHTIP_DOMAIN` doit être l'URL réelle par laquelle la CLI joint GlitchTip.

### Exploitation

- **OBS-40** Dimensionnement : la pile d'observabilité (collecteur, OpenObserve, GlitchTip et sa base) s'ajoute aux services de DEP-02. Mesurer sa consommation en préproduction avant de choisir la taille du VPS. Mesure à vide en local (essai du 2026-11-12) : GlitchTip 7 172 Mio, sa base 78 Mio, collecteur 40 Mio, OpenObserve 287 Mio, soit environ 577 Mio avant tout trafic.
- **OBS-41** Sonde externe : si le serveur tombe, sa propre surveillance tombe avec lui. Une sonde hors du serveur interroge `/health/ready` et reçoit un signal de vie du worker. C'est la seule dépendance externe d'observabilité ; elle ne reçoit aucune donnée d'utilisateur.
- **OBS-42** Sauvegardes : la base de GlitchTip suit DEP-05 mais sa perte est tolérée ; OpenObserve n'est pas sauvegardé (rétention courte). Les tableaux de bord, règles d'alerte et configurations du collecteur sont versionnés dans `ops/observability/`.
- **OBS-43** Acheminement des alertes : GlitchTip et OpenObserve envoient par e-mail (SMTP direct) ou webhook, sans passer par l'application, pour qu'une panne de l'application n'étouffe pas l'alerte qui la signale.
- **OBS-44** Développement local : un profil Docker Compose `obs` démarre la pile à la demande ; sans lui, le développement ordinaire n'en dépend pas (OBS-14).

### Critères d'acceptation (observabilité)

- Sans variable de télémétrie, l'API démarre, répond, et n'émet aucune connexion sortante.
- Collecteur, OpenObserve ou GlitchTip arrêtés : l'API répond avec la même latence et sans erreur.
- Le test OBS-26 est vert.
- Une exception provoquée en préproduction apparaît dans GlitchTip avec une pile lisible (fichier et ligne TypeScript) et un identifiant de trace qui ouvre la trace correspondante dans OpenObserve.
- Aucune source map n'est servie par le domaine de l'application.
- Un événement d'erreur de l'API porte le même `trace_id` que la trace correspondante (OBS-12), et la configuration `dataCollection` fermée de chaque processus est vérifiée par un test (OBS-28).
- Après un déploiement, l'envoi des cartes est vérifié côté serveur (OBS-34), pas seulement par le code de retour de la CLI.

### Questions ouvertes (observabilité)

1. ~~Composants exacts de GlitchTip~~ Tranchée par l'essai du 2026-11-12 : un seul service, base séparée, Valkey facultatif (DEP-02).
2. ~~Coexistence Sentry et OpenTelemetry~~ Tranchée par l'essai du 2026-11-12 : OBS-12, OBS-28.
3. Choix de la sonde externe (service gratuit ou second petit serveur).
4. Taille du VPS une fois la pile mesurée ; séparer la surveillance sur un second serveur si elle pèse trop.
5. Poids du SDK Sentry dans le navigateur : l'application d'essai, vide, pèse 302 ko de JavaScript au premier chargement avec le SDK. À mesurer sur la vraie application contre l'objectif de 2 s ; charger le SDK en différé si le budget est dépassé.

## Objectifs de performance

| Mesure | Cible |
|---|---|
| Premier affichage utile sur mobile 4G | < 2 s |
| Réaction à un geste | < 100 ms |
| Réponse d'API, 95e centile | < 300 ms |
| Diffusion d'un événement temps réel | < 1 s |
| Fiche complétée après collage d'un lien, médiane | < 6 s |
| Disponibilité mensuelle | 99,5 % |

## Critères d'acceptation

- Une branche qui importe Prisma depuis un dossier `domain` échoue en CI.
- Une branche qui modifie un DTO sans régénérer le client échoue en CI.
- Une restauration complète a été faite en préproduction avant la mise en production.

## Questions ouvertes

1. Une seule machine au départ : pas de haute disponibilité. Acceptable pour le lancement ; à revoir selon l'usage.
2. Fournisseur d'e-mails transactionnels à choisir (hébergé dans l'UE).
