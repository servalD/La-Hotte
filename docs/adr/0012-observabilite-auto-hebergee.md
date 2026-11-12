# ADR 0012 — Observabilité auto-hébergée : GlitchTip, OpenObserve, collecteur OpenTelemetry

**Statut :** accepté · 2026-11-12

## Contexte

Il faut voir ce qui casse (exceptions TypeScript avec une pile lisible), ce qui ralentit et ce qui dérive (logs, métriques, traces de toute la pile). Les données restent chez nous, dans l'Union européenne (RGPD-01), sur le même VPS (ADR 0008). Et le produit a une contrainte que peu d'autres ont : **la télémétrie ne doit jamais révéler une surprise**. Une exception qui embarque un corps de requête, ou un journal qui contient l'URL d'un article, fuit un cadeau vers quiconque lit les outils d'exploitation.

## Décision

1. **GlitchTip** pour les erreurs. Il parle le protocole Sentry : on utilise les SDK Sentry (`@sentry/nestjs` pour l'API, `@sentry/node` pour le worker et le fetcher, `@sentry/nextjs` pour le web) avec un DSN GlitchTip. Rôle strict : regrouper les exceptions, alerter, afficher des piles lisibles grâce aux source maps. Aucune trace ni aucun journal n'y est envoyé.
2. **OpenObserve** pour les journaux, les métriques et les traces, reçus en OTLP/HTTP.
3. **Un collecteur OpenTelemetry** (`otel-collector`) entre les deux mondes : les applications lui envoient tout en OTLP, il exporte vers OpenObserve. Il est le seul à connaître les identifiants d'OpenObserve, ajoute une seconde barrière de nettoyage (suppression d'attributs interdits), met en tampon si OpenObserve est indisponible, et collecte aussi l'hôte, PostgreSQL, Redis, Caddy et les conteneurs.
4. **Un seul SDK OpenTelemetry par processus**, initialisé avant tout autre import (`instrument.ts`). Le SDK Sentry est initialisé avec `skipOpenTelemetrySetup: true` et sans `SentrySpanProcessor` : il garde les erreurs, ne duplique pas la création de spans.
5. **Corrélation** : chaque événement d'erreur porte `trace_id` et `request_id` ; chaque ligne de journal porte `trace_id` et `span_id` quand une trace est active. On passe d'une exception dans GlitchTip à sa trace dans OpenObserve.
6. **Nettoyage à la source**, dans un module unique `platform/telemetry/scrub`, appliqué aux événements d'erreur, aux fils d'Ariane, aux attributs de spans et aux sérialiseurs de journaux. Les règles sont celles d'OBS-20 à OBS-27 (`docs/spec/14`).
7. **Source maps** envoyées à GlitchTip par `glitchtip-cli` au déploiement (release = SHA du commit), puis retirées de ce qui est servi au navigateur.
8. **Navigateur** : les erreurs transitent par un relais de notre origine (`/monitoring`, route Next écrite par nous, qui ne transmet qu'à notre projet GlitchTip). La CSP garde `connect-src 'self'` et GlitchTip n'a pas à être joignable publiquement pour la collecte.
9. **Télémétrie désactivée par défaut** : sans DSN ni point de terminaison, rien n'est initialisé ni envoyé (développement, tests, CI). Une panne de l'un des trois outils ne doit jamais ralentir ni faire échouer une requête.
10. **Côté domaine** : les métriques métier (refus d'autorisation, extractions, coût du modèle) passent par un port `Metrics` du noyau partagé, comme `Clock`. `domain` et `application` n'importent jamais `platform/telemetry`.

## Raisons

- GlitchTip est beaucoup plus léger qu'un Sentry auto-hébergé complet et suffit pour ce qu'on lui demande : issues, alertes, piles lisibles. On garde la maturité des SDK Sentry sans en payer l'infrastructure.
- OpenObserve reçoit nativement les trois signaux OTLP dans un seul outil, ce qui évite d'assembler Prometheus, Loki et Tempo.
- OTLP via collecteur découple les applications du stockage : changer d'outil d'observation, c'est changer la configuration du collecteur, pas le code.
- Séparer erreurs et télémétrie évite d'envoyer deux fois les mêmes spans et de dépendre du support partiel des traces par GlitchTip.
- Le nettoyage en deux barrières (à la source, puis au collecteur) répond au risque propre au produit.

## Conséquences

- **Trois à quatre services de plus** en production : `otel-collector`, `openobserve`, `glitchtip-web`, `glitchtip-worker`, plus une base PostgreSQL dédiée à GlitchTip. Le dimensionnement du VPS est à mesurer en préproduction (OBS-40).
- **La surveillance partage le sort du serveur.** Si le VPS tombe, elle tombe avec lui : une sonde externe est nécessaire (OBS-41).
- **Les interfaces d'exploitation ne sont pas des interfaces de l'application** : accès nominatif, TOTP, restreint par réseau (OBS-27). Elles ne sont pas couvertes par ADM-01 et doivent donc respecter le même principe : ne jamais contenir de contenu privé.
- **Points à confirmer par un essai en début de chantier** (tâche 1 de la phase 0 bis) :
  - la coexistence du SDK Sentry (`skipOpenTelemetrySetup`) avec le SDK OpenTelemetry sur NestJS 11 et Next.js 15 ;
  - le flux de source maps de GlitchTip : sa documentation actuelle passe par `glitchtip-cli` (injection d'identifiants de débogage puis envoi) et signale la CLI comme bêta ; des retours publics indiquent que `sentry-cli` ne stocke pas les cartes sur certaines versions ;
  - les composants exacts de la version de GlitchTip retenue (base seule, ou base et Redis) ;
  - le relais navigateur `/monitoring` (l'option `tunnelRoute` du greffon Next de Sentry n'est pas prévue pour un hôte autre que Sentry : on écrit le relais nous-mêmes avec une liste blanche).
- Les attributs des spans de bibliothèques instrumentées automatiquement (HTTP, base, Redis) sont à filtrer un par un : le défaut d'une instrumentation est de trop en dire.

## Résultat de l'essai (2026-11-12)

Les « points à confirmer » ci-dessus ont été vérifiés (tâche 1 de la phase 0 bis). Ce qui précède reste l'état de la décision au départ ; ce qui suit la corrige et prévaut.

**Versions de l'essai :** GlitchTip 7.0.0 (essai croisé avec 6.2.6), `otel-collector-contrib` 0.165.0, OpenObserve 1.1.2, `@sentry/nestjs` et `@sentry/nextjs` 11.12.0, `@opentelemetry/sdk-node` 0.301.1, Prisma 6.19, NestJS 11.1, Next 15.5, `glitchtip-cli` 1.0.0.

**Corrections à la décision**

- **Point 3 (services).** Il n'y a pas de `glitchtip-worker` : depuis GlitchTip 7, un seul processus sert le HTTP et consomme la file, et refuse de démarrer avec un rôle de worker. Valkey/Redis est facultatif (`VALKEY_URL` vide : Postgres sert de file). PostgreSQL demande `max_locks_per_transaction=512`. Mémoire à vide : GlitchTip 172 Mio, sa base 78 Mio, collecteur 40 Mio, OpenObserve 287 Mio, soit environ 577 Mio.
- **Point 4 (Sentry et OpenTelemetry).** `skipOpenTelemetrySetup` n'existe plus en Sentry 11 ; son équivalent inversé, `enableOpenTelemetrySetup`, est faux par défaut côté Node. Le montage retenu est celui que Sentry appelle « votre OpenTelemetry, Sentry lié » : OpenTelemetry possède les spans, Sentry les erreurs, avec `Sentry.openTelemetryIntegration()` et sans `tracesSampleRate`. Cette intégration seule ne suffit pas : le `trace_id` des erreurs ne correspond pas, car le span interne de Sentry l'emporte ; un `beforeSend` pose celui du span OpenTelemetry actif (vérifié : `trace_id` identique dans GlitchTip et dans le collecteur). Le processus se lance avec `node --import`, `--require` n'étant plus pris en charge.
- **Nettoyage (points 6 et 10).** Sentry 11 collecte **tout** par défaut (cookies, en-têtes, corps, SQL, variables locales) et `sendDefaultPii` a disparu. La configuration `dataCollection` doit être fermée explicitement (OBS-28). Même fermée, les fils d'Ariane `console` et `http`, le message d'exception et le chemin de l'URL restent : `scrub` doit les traiter. Côté spans, les instrumentations posent par défaut l'URL complète, la chaîne de requête, le texte SQL avec ses valeurs, le message et la pile d'exception, les adresses réseau (liste dans OBS-29).
- **Point 7 (source maps).** La route d'envoi par fichier répond 405 sur GlitchTip 7. `glitchtip-cli` 1.0.0 : `sourcemaps inject` fonctionne ; `sourcemaps upload` envoie chaque fichier brut et appelle l'assemblage, alors que le serveur attend un zip avec `manifest.json` ; le serveur rejette (« not a zip file ») et la CLI retourne un succès (même résultat avec GlitchTip 6.2.6). Un bundle fabriqué par un script maison (zip, manifest, envoi par morceaux, assemblage) est accepté et la pile est résolue en TypeScript. Décision : `inject` par la CLI, bundle par un script du dépôt, vérification côté serveur (OBS-31, OBS-34). La CLI n'a pas de binaire signé : on la compile depuis crates.io avec `--locked` (OBS-35).
- **API et source maps.** `node --enable-source-maps` suffit à produire des piles TypeScript ; les cartes de l'API n'ont pas besoin de GlitchTip (OBS-32). Seul le navigateur dépend de GlitchTip pour des piles lisibles.
- **Points inchangés, vérifiés.** Désactivation par défaut et indépendance vis-à-vis des pannes (OBS-14) : sans variables, aucune connexion sortante ; collecteur et GlitchTip arrêtés, la latence reste la même. Relais `/monitoring` : fonctionne avec `connect-src 'self'`, sans violation de la CSP, et refuse ce qui n'est pas pour notre projet (OBS-33).

**Pièges de versions relevés** (à épingler, voir la roadmap) : `@opentelemetry/instrumentation-http` 0.301.2 dépend d'un paquet jamais publié (prendre 0.301.1) ; `@prisma/instrumentation` 7.x est incompatible avec Prisma 6.19 et fait échouer les requêtes (prendre 6.19) ; le SDK navigateur ajoute environ 300 ko de JavaScript au premier chargement d'une page vide (question ouverte 5 de `14`).

## Alternatives écartées

- **Sentry auto-hébergé** : mêmes SDK et meilleure fonction de traces, mais une pile bien plus lourde pour un VPS unique.
- **Sentry hébergé** : sous-traitant de plus, données hors du périmètre maîtrisé, et la télémétrie est justement l'endroit où une fuite de surprise est la plus probable.
- **Grafana (Loki, Tempo, Prometheus), SigNoz** : bons outils, plusieurs composants à opérer ; OpenObserve couvre le besoin avec un seul service.
- **Applications qui exportent directement vers OpenObserve** : plus simple d'un service, mais les identifiants se retrouvent dans chaque application, sans tampon ni seconde barrière de nettoyage.
- **Traces envoyées aussi à GlitchTip** : doublon, et prise en charge des traces moins complète que celle d'OpenObserve.
