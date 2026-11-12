# ADR 0009 — Contrat d'API : OpenAPI émis par NestJS, client et Zod générés

**Statut :** accepté · 2026-11-11

## Contexte

Le web doit connaître les types de l'API et valider ses formulaires sans que les schémas soient écrits deux fois.

## Décision

1. Les **DTO NestJS** (classes, `class-validator`, `@nestjs/swagger` avec son plugin CLI qui déduit types et contraintes) sont la source unique.
2. Une commande émet `openapi.json` sans démarrer le serveur.
3. **Orval** génère `packages/api-client` : client HTTP typé, schémas **Zod**, hooks TanStack Query.
4. Les deux artefacts sont versionnés ; la CI régénère et échoue en cas de différence.
5. Les événements temps réel, hors du champ d'OpenAPI, ont des schémas Zod écrits à la main dans `packages/api-client/src/realtime`.

## Raisons

- On écrit le contrat une fois ; client, types, validation de formulaire et hooks sont produits.
- `openapi.json` sert aussi aux tests de schéma (aucun champ d'offreur dans une vue destinataire, API-12).
- La différence du fichier généré rend toute rupture de contrat visible en revue.

## Conséquences

- La qualité du Zod généré dépend de la précision des DTO : contraintes explicites obligatoires (API-04).
- Le Zod généré ne contient pas les règles métier croisées ; le serveur reste l'autorité (API-03).
- Les unions discriminées et vues polymorphes demandent des annotations soignées ; à vérifier sur `ItemRecipientView` / `ItemGiverView` dès la phase 0.
- Outil de génération à confirmer par un essai en phase 0 (Orval, ou `@hey-api/openapi-ts` en repli) : le choix ne change rien à l'architecture.

## Alternatives écartées

- **Zod écrit à la main et partagé** (`nestjs-zod`) : une seule écriture aussi et des règles plus expressives, mais le client HTTP et les hooks restent à écrire ou à générer par un second outil.
- **tRPC / ts-rest** : typage de bout en bout sans génération, mais s'intègre mal aux contrôleurs NestJS classiques et ne produit pas de document OpenAPI standard aussi directement.
- **GraphQL** : une couche de plus, et un filtrage par champ qui compliquerait la preuve de non-fuite.
