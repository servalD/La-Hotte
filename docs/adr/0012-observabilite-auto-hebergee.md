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

## Alternatives écartées

- **Sentry auto-hébergé** : mêmes SDK et meilleure fonction de traces, mais une pile bien plus lourde pour un VPS unique.
- **Sentry hébergé** : sous-traitant de plus, données hors du périmètre maîtrisé, et la télémétrie est justement l'endroit où une fuite de surprise est la plus probable.
- **Grafana (Loki, Tempo, Prometheus), SigNoz** : bons outils, plusieurs composants à opérer ; OpenObserve couvre le besoin avec un seul service.
- **Applications qui exportent directement vers OpenObserve** : plus simple d'un service, mais les identifiants se retrouvent dans chaque application, sans tampon ni seconde barrière de nettoyage.
- **Traces envoyées aussi à GlitchTip** : doublon, et prise en charge des traces moins complète que celle d'OpenObserve.
