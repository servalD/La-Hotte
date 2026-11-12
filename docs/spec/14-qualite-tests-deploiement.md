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
| `glitchtip-web`, `glitchtip-worker` | Erreurs (OBS-04) ; composants exacts à confirmer par l'essai de la phase 0 bis | restreinte (OBS-27) |
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
- **OBS-12** Corrélation : les événements d'erreur portent `trace_id` et `request_id` ; on passe d'une issue GlitchTip à sa trace OpenObserve.
- **OBS-13** Nommage : services `wishlist-api`, `wishlist-web`, `wishlist-worker`, `wishlist-fetcher` ; `environment` = `development`, `preview` ou `production` ; `release` = SHA du commit déployé.
- **OBS-14** Désactivée par défaut : sans DSN ni point de terminaison, rien n'est initialisé ni envoyé (développement, tests, CI). Une panne de GlitchTip, du collecteur ou d'OpenObserve ne ralentit ni ne fait échouer aucune requête : envois asynchrones, mis en lot, file bornée, abandon silencieux de ce qui déborde.
- **OBS-15** Échantillonnage des traces : 100 % en préproduction, 10 % en production (réglable par variable d'environnement). Les erreurs sont toujours envoyées à GlitchTip.
- **OBS-16** Rétention : erreurs 90 jours, journaux 30 jours (SEC-33), traces 14 jours, métriques 90 jours. Le journal de sécurité (SEC-30) reste en base de données, pour 12 mois : OpenObserve n'en est pas la source de vérité.

### Confidentialité de la télémétrie

C'est ici que le produit diffère : un rapport d'erreur est un canal de sortie comme un autre, et la règle de surprise (VIS-20) s'y applique.

- **OBS-20** SEC-31 vaut pour tout ce qui part vers un outil d'observation : journaux, attributs de spans, étiquettes de métriques, événements d'erreur, fils d'Ariane. Sont interdits : corps de requête et de réponse, en-têtes (cookies, `Authorization`, `Idempotency-Key`), chaîne de requête, valeurs de paramètres SQL, texte de commentaire, titre de liste ou d'article, montants de parts et de participations, noms et adresses e-mail, et **l'URL d'un article** (elle révèle le cadeau).
- **OBS-21** On journalise le gabarit de route (`/items/:id`), jamais l'URL résolue avec sa chaîne de requête. Aucun contexte utilisateur n'est posé sur les erreurs (`sendDefaultPii` faux, pas de `setUser`), et un identifiant de profil n'est jamais associé à une action sur un élément (qui réserve quoi).
- **OBS-22** Le nettoyage se fait à la source, dans un module unique `platform/telemetry/scrub`, appliqué aux événements d'erreur, aux fils d'Ariane, aux attributs de spans et aux sérialiseurs de journaux. Le collecteur ajoute une seconde barrière : un processeur qui supprime les clés interdites.
- **OBS-23** Bases de données : nom de l'opération et durée, jamais le texte d'une requête avec ses valeurs ni ses paramètres.
- **OBS-24** Extraction et fetcher : le nom de domaine seulement, jamais l'URL complète, jamais le contenu d'une page ni la sortie du modèle.
- **OBS-25** Seules les erreurs inattendues sont signalées à GlitchTip : 5xx, exceptions non gérées, échecs de tâches de fond. Les erreurs métier (`DomainError`, 4xx) sont comptées en métrique par `code`, pas signalées. Le message d'une exception n'interpole jamais de donnée d'utilisateur.
- **OBS-26** Test de non-fuite de la télémétrie, bloquant en CI : des marqueurs reconnaissables sont placés dans corps de requête, commentaires, titres, URL d'article et montants ; on provoque des erreurs et des requêtes ; on vérifie qu'aucun marqueur n'apparaît dans les journaux, spans, métriques et événements d'erreur capturés par des exporteurs de test.
- **OBS-27** Accès : interfaces GlitchTip et OpenObserve réservées à l'exploitation, comptes nominatifs avec TOTP, séparées des rôles de l'application (RBAC-01), non exposées sur le domaine de l'application, restreintes par réseau (liste d'adresses ou VPN).

### Source maps et relais navigateur

- **OBS-30** Le navigateur ne reçoit jamais de source maps : générées au build, envoyées à GlitchTip, retirées de ce qui est publié.
- **OBS-31** Envoi par `glitchtip-cli` (injection d'identifiants de débogage, puis envoi), au déploiement seulement et pas sur les demandes de fusion ; release = SHA du commit. `sentry-cli` n'est pas utilisé (voir l'ADR 0012 pour le motif).
- **OBS-32** L'API, le worker et le fetcher suivent la même règle : build avec cartes, envoi à GlitchTip, exécution avec `--enable-source-maps`.
- **OBS-33** Les erreurs du navigateur transitent par un relais de notre origine, `/monitoring` : route Next écrite par nous, qui n'accepte que les enveloppes destinées à notre projet GlitchTip (liste blanche), avec taille et débit limités. La CSP garde `connect-src 'self'`. Un relais qui accepterait n'importe quelle destination serait un relais ouvert.

### Exploitation

- **OBS-40** Dimensionnement : la pile d'observabilité (collecteur, OpenObserve, GlitchTip et sa base) s'ajoute aux services de DEP-02. Mesurer sa consommation en préproduction avant de choisir la taille du VPS.
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

### Questions ouvertes (observabilité)

1. Composants exacts de la version de GlitchTip retenue (base seule ou avec Redis) : à lire dans l'essai de la phase 0 bis.
2. Coexistence du SDK Sentry et du SDK OpenTelemetry sur NestJS 11 et Next.js 15 : à confirmer par l'essai.
3. Choix de la sonde externe (service gratuit ou second petit serveur).
4. Taille du VPS une fois la pile mesurée ; séparer la surveillance sur un second serveur si elle pèse trop.

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
