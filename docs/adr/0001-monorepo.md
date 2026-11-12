# ADR 0001 — Monorepo pnpm + Turborepo

**Statut :** accepté · 2026-11-11

## Contexte

Une API NestJS, une application Next.js et un client d'API généré qui doit rester synchronisé avec les deux.

## Décision

Un seul dépôt, espaces de travail pnpm, orchestration Turborepo. `apps/api`, `apps/web`, `packages/api-client`, `packages/config`.

## Raisons

- Un changement de contrat (DTO → OpenAPI → client → écran) tient dans une seule demande de fusion et se vérifie en CI.
- Un seul jeu de règles de lint, de typage et de versions.
- Cache de build et de tests de Turborepo.

## Conséquences

- La CI doit ne lancer que ce qui est touché.
- Pas de paquet `domain` partagé avec le web : le domaine reste dans l'API, le web ne connaît que le contrat.

## Alternatives écartées

Deux dépôts (désynchronisation du contrat) ; Nx (plus lourd que nécessaire ici).
