# packages/api-client — client d'API généré

Décision : `docs/adr/0009-contrat-api-openapi.md`. Spec : `docs/spec/13-api-temps-reel.md`.

## Ne pas éditer

Tout `src/generated/` est **généré** à partir de `apps/api/openapi.json` par Orval (`orval.config.ts`). Écrits à la main : `src/realtime/`, `src/http/fetcher.ts` (transport : cookie de session, erreurs `ApiError` portant le `code` RFC 9457), et les points d'entrée `src/index.ts` et `src/zod.ts`, **à compléter quand un nouveau tag d'API apparaît** (un fichier par tag dans `generated/endpoints/<tag>/` et `generated/zod/<tag>/`).

Usage : `import { useGetExampleItem, ApiError } from '@wishlist/api-client'` ; schémas : `import { exampleItemsSchemas } from '@wishlist/api-client/zod'`. Les hooks renvoient le corps ; une erreur est levée, jamais renvoyée.

Pour changer un type, un schéma Zod ou un hook :

1. Modifier le DTO dans `apps/api`.
2. Lancer `pnpm generate`.
3. Versionner `openapi.json` et les fichiers régénérés dans le même commit.

Une modification manuelle sera écrasée et fait échouer la CI.

## `src/realtime/` (écrit à la main)

Schémas Zod des événements WebSocket, partagés par l'API et le web. Un schéma par type d'événement, enveloppe commune `{ type, id, seq, at, data }`.

Les événements destinés à un salon public ne contiennent aucun champ d'offreur : deux schémas distincts plutôt que des champs facultatifs.

## Compatibilité

L'API `v1` n'évolue que par ajout de champs facultatifs. Un client installé et hors ligne peut avoir plusieurs jours de retard : un champ renommé ou retiré le casse. Une rupture passe par `v2`.

## Si le Zod généré est trop lâche

Le DTO manque de contraintes. Ajouter longueurs, bornes, formats et énumérations dans le DTO, pas ici.
