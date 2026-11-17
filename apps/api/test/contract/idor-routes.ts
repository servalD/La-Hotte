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

// SEC-03, EVT-08 : routes à identifiant du module `events` (phase 3), couvertes par la table IDOR
// de `events-security.spec.ts`.
export const PHASE3_IDOR_ROUTES: readonly string[] = [
  'GET /api/v1/events/:id',
  'PATCH /api/v1/events/:id',
  'DELETE /api/v1/events/:id',
  'POST /api/v1/events/:id/cancel',
  'POST /api/v1/events/:id/recreate',
  'GET /api/v1/events/:id/participants',
  'POST /api/v1/events/:id/participants',
  'DELETE /api/v1/events/:id/participants/:profileId',
  'PUT /api/v1/events/:id/organizers/:profileId',
  'DELETE /api/v1/events/:id/organizers/:profileId',
  'POST /api/v1/events/:id/honorees',
  'PUT /api/v1/events/:id/rsvp',
  'GET /api/v1/events/:id/links',
  'POST /api/v1/events/:id/links',
  'DELETE /api/v1/events/:id/links/:linkId',
  // EVT-20 à EVT-27 : reprise et pioche.
  'GET /api/v1/events/:id/carry-over',
  'POST /api/v1/events/:id/carry-over',
  'GET /api/v1/events/:id/ideas',
  // EVT-30, EVT-31
  'GET /api/v1/events/:id/progress',
  // EVT-29 : rattachement d'une liste.
  'PUT /api/v1/lists/:id/event',
  'DELETE /api/v1/lists/:id/event',
];

// SEC-03, COM-11 : routes à identifiant des échanges (phase 4), couvertes par la table IDOR de
// `exchanges-security.spec.ts`.
export const PHASE4_IDOR_ROUTES: readonly string[] = [
  'GET /api/v1/items/:id/threads',
  'GET /api/v1/items/:id/comments',
  'POST /api/v1/items/:id/comments',
  'PATCH /api/v1/comments/:id',
  'DELETE /api/v1/comments/:id',
  'PUT /api/v1/comments/:id/reactions/:reaction',
  'DELETE /api/v1/comments/:id/reactions/:reaction',
  'PUT /api/v1/items/:id/follow',
  'DELETE /api/v1/items/:id/follow',
];

// SEC-03, CPT-59 : routes à identifiant de la compta (phase 5), couvertes par la table IDOR de
// `accounting-contributions.spec.ts` (et, en fin de phase, `accounting-security.spec.ts`).
export const PHASE5_IDOR_ROUTES: readonly string[] = [
  'GET /api/v1/items/:id/accounting',
  'PUT /api/v1/items/:id/contribution',
  'DELETE /api/v1/items/:id/contribution',
  'PUT /api/v1/items/:id/accounting/options',
  'POST /api/v1/accounting-reviews/:id/approve',
  'POST /api/v1/accounting-reviews/:id/refuse',
  'PUT /api/v1/items/:id/purchase',
  'DELETE /api/v1/items/:id/purchase',
  'POST /api/v1/items/:id/contribution/lower',
  'POST /api/v1/items/:id/shortfall-notice',
  'POST /api/v1/items/:id/buyer-requests',
  'POST /api/v1/buyer-requests/:id/accept',
  'POST /api/v1/buyer-requests/:id/refuse',
  'DELETE /api/v1/buyer-requests/:id',
  'PUT /api/v1/items/:id/purchase/receipt',
  'GET /api/v1/items/:id/purchase/receipt',
  'PUT /api/v1/contributions/:id/settlement',
  'POST /api/v1/contributions/:id/claim',
  'POST /api/v1/contributions/:id/nudge',
  'POST /api/v1/offset-proposals/:id/confirm',
  'POST /api/v1/offset-proposals/:id/decline',
  'DELETE /api/v1/budgets/:id',
];

// RBAC-04, RBAC-05 : routes de l'espace d'administration (phase 7). L'identifiant y désigne par
// conception un compte cible : la barrière est la permission de plateforme, vérifiée route par
// route dans `admin-rbac.spec.ts` (USER et MODERATOR reçoivent le 404 d'une route inconnue).
export const PHASE7_ADMIN_ROUTES: readonly string[] = [
  'POST /api/v1/admin/accounts/:id/suspend',
  'POST /api/v1/admin/accounts/:id/reactivate',
  'POST /api/v1/admin/accounts/:id/force-logout',
  'POST /api/v1/admin/accounts/:id/totp-reset',
  'PUT /api/v1/admin/accounts/:id/role',
  'PUT /api/v1/admin/settings/:key',
];
