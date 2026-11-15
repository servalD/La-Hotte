// SEC-03 : routes à identifiant des modules de la phase 2, couvertes par la table IDOR de
// `lists-security.spec.ts`. Le test « aucune route à identifiant n'échappe » d'
// `identity-security.spec.ts` exige qu'une route à paramètre soit dans sa table ou dans celle-ci.
export const PHASE2_IDOR_ROUTES: readonly string[] = [
  'GET /api/v1/products/:id',
  'PATCH /api/v1/products/:id',
  // EXT-47 : clé de capacité, et non identifiant ; vérifiée comme les autres (inconnue = 404).
  'GET /api/v1/images/:key',
  'GET /api/v1/lists/:id',
  'PATCH /api/v1/lists/:id',
  'DELETE /api/v1/lists/:id',
  'POST /api/v1/lists/:id/restore',
  'GET /api/v1/lists/:id/members',
  'PUT /api/v1/lists/:id/members/:profileId',
  'DELETE /api/v1/lists/:id/members/:profileId',
  'POST /api/v1/lists/:id/leave',
  'GET /api/v1/lists/:id/items',
  'POST /api/v1/lists/:id/items',
  'GET /api/v1/items/:id',
  'PATCH /api/v1/items/:id',
  'DELETE /api/v1/items/:id',
  'POST /api/v1/items/:id/received',
  'DELETE /api/v1/items/:id/received',
  'POST /api/v1/items/:id/withdraw',
  'POST /api/v1/items/:id/copy',
  'GET /api/v1/items/:id/visibility',
  'PUT /api/v1/items/:id/visibility',
  'GET /api/v1/lists/:id/visibility-log',
  'PUT /api/v1/products/:id/share',
  'POST /api/v1/directory/:productId/copy',
];
