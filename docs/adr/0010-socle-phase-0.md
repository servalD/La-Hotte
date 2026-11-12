# ADR 0010 — Socle de la phase 0 : versions, génération du client, règle d'architecture

**Statut :** accepté · 2026-11-12

## Contexte

La phase 0 devait confirmer par un essai l'outil de génération du client (ADR 0009), choisir les versions de la pile et rendre bloquante la règle d'architecture (QA-03).

## Décision

1. **Orval est retenu** (repli `@hey-api/openapi-ts` écarté). Essai fait sur `GET /example-items/{id}`, réponse `oneOf` avec `discriminator` : Orval produit une union TypeScript discriminée par `view`, un schéma Zod en `union` d'objets, des hooks TanStack Query. Réglages : mode `tags-split`, transport `src/http/fetcher.ts`, `includeHttpResponseReturnType: false` (les hooks renvoient le corps, les erreurs sont levées en `ApiError`).
2. **Versions majeures éprouvées plutôt que les toutes dernières** : NestJS 11, Prisma 6, TypeScript 5.9, ESLint 9, Vitest 3, Next.js 15, Motion 12, Orval 7, Zod 3.25. Les versions publiées au même moment (NestJS 12, Prisma 8 en préversion, TypeScript 7, ESLint 10, Vitest 5) sont récentes ; leur compatibilité mutuelle (plugin Swagger, métadonnées de décorateurs, `typescript-eslint`) n'est pas encore établie. Une montée de version se fait par tâche dédiée, une bibliothèque à la fois, CI verte à l'appui.
3. **Règle d'architecture écrite pour le projet** (`packages/config/eslint/rules/architecture.mjs`, règle `architecture/layers`) plutôt qu'un greffon générique : elle encode exactement QA-02 et QA-03 (sens des couches, `index.ts` seul importable entre modules, aucun paquet dans `domain`, `platform` interdit à `domain` et `application`), ses messages sont en français et elle est testée (`packages/config/test`). Une sentinelle de CI (`pnpm lint:architecture`) vérifie que le lint réel refuse un import interdit.
4. **UUID v7 produits par l'application** (port `IdGenerator`), sans dépendre de `uuidv7()` de PostgreSQL 18 : fonctionne sur PostgreSQL 16 et 17.
5. **`openapi.json` émis en mode aperçu de NestJS** : aucun fournisseur instancié, donc ni base ni Redis nécessaires pour générer le contrat.

## Raisons

- Le contrat polymorphe, point de risque nommé par l'ADR 0009, passe sans annotation exotique.
- Une pile dont les pièces sont connues ensemble réduit le coût des premières phases, où l'essentiel est dans les règles métier.
- Une règle maison de 150 lignes, testée, est plus lisible et plus stricte qu'une configuration de greffon générique.

## Conséquences

- `packages/api-client/src/index.ts` et `src/zod.ts` sont à compléter à la main quand un nouveau tag apparaît.
- Le Zod de réponse est une `union`, pas une `discriminatedUnion` : suffisant pour vérifier une réponse, moins précis dans les messages d'erreur.
- Dette assumée : montée vers les versions majeures récentes à planifier après la phase 1.

## Alternatives écartées

`@hey-api/openapi-ts` (non nécessaire, l'essai Orval étant concluant) ; `eslint-plugin-boundaries` (configuration plus opaque pour le même résultat) ; dernières versions majeures dès le départ (risque d'intégration sans bénéfice fonctionnel à ce stade).
