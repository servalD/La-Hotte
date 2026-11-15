// SEC-03 : routes à identifiant des modules de la phase 2, couvertes par la table IDOR de
// `lists-security.spec.ts`. Le test « aucune route à identifiant n'échappe » d'
// `identity-security.spec.ts` exige qu'une route à paramètre soit dans sa table ou dans celle-ci.
export const PHASE2_IDOR_ROUTES: readonly string[] = [
  'GET /api/v1/products/:id',
  'PATCH /api/v1/products/:id',
  // EXT-47 : clé de capacité, et non identifiant ; vérifiée comme les autres (inconnue = 404).
  'GET /api/v1/images/:key',
];
