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

- **CI-01** À chaque demande de fusion, étapes bloquantes : installation verrouillée, lint (dont règles d'architecture), typage, tests unitaires et matrice, tests d'intégration, génération du contrat sans différence (API-02), build, audit des dépendances, détection de secrets.
- **CI-02** Tests de bout en bout sur la branche principale et avant chaque mise en production.
- **CI-03** Aucune fusion directe sur la branche principale. Les changements sensibles (SEC-40) exigent la revue de sécurité.
- **CI-04** Commits conventionnels ; journal des changements généré.

## Environnements et déploiement

- **DEP-01** Trois environnements : local (Docker Compose), préproduction, production. Mêmes images, configuration par variables d'environnement.
- **DEP-02** Production sur un VPS dans l'Union européenne, Docker Compose :

| Service | Rôle | Exposition |
|---|---|---|
| `caddy` | Proxy inverse, TLS automatique, en-têtes de sécurité | 80, 443 |
| `web` | Next.js | interne |
| `api` | NestJS (REST + WebSocket) | interne |
| `worker` | Files BullMQ : notifications, e-mails, rappels | interne |
| `fetcher` | Récupération d'URL et d'images, **réseau isolé**, sortie filtrée (EXT-44) | aucune entrée |
| `postgres` | Données | interne |
| `redis` | Sessions, files, pub/sub | interne |

- **DEP-03** Conteneurs sans privilèges, système de fichiers en lecture seule quand c'est possible, images minimales, mises à jour de sécurité automatiques de l'hôte, pare-feu ne laissant que 80, 443 et l'accès d'administration par clé.
- **DEP-04** Déploiement : image construite et analysée en CI, migration de base, démarrage, vérification de santé, bascule ; retour arrière par l'image précédente. Les migrations sont compatibles avec la version précédente du code (DAT-07).
- **DEP-05** Sauvegardes : base complète quotidienne + journaux de transactions en continu, chiffrées, copiées hors du serveur, conservées 30 jours ; images sauvegardées de la même façon. Restauration testée chaque mois (SEC-23).
- **DEP-06** Objectifs de reprise : perte de données ≤ 15 minutes, remise en service ≤ 4 heures.

## Observabilité

- **OBS-01** Journaux structurés en JSON avec identifiant de requête propagé de bout en bout ; aucune donnée de contenu (SEC-31).
- **OBS-02** Métriques : latence et erreurs par route, connexions WebSocket, longueur des files, durée et taux de réussite des extractions, jetons consommés et coût par jour, refus d'autorisation.
- **OBS-03** Traces OpenTelemetry sur l'API et les tâches de fond.
- **OBS-04** Suivi des erreurs côté client et serveur, auto-hébergé, sans données personnelles.
- **OBS-05** Alertes : indisponibilité, taux d'erreur, file bloquée, sauvegarde échouée, certificat proche de l'expiration, dépassement du budget d'extraction.
- **OBS-06** Points de santé : `/health/live`, `/health/ready`.

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
