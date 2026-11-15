import { ApiError } from '@wishlist/api-client';

/** Codes d'erreur des listes, fiches et répertoire que l'interface sait expliquer (API-14). */
const KNOWN = new Set([
  'LIST_NOT_FOUND',
  'ITEM_NOT_FOUND',
  'LIST_ACTION_FORBIDDEN',
  'VISIBILITY_EDIT_FORBIDDEN',
  'RECIPIENT_NOT_ALLOWED',
  'MEMBER_NOT_ALLOWED',
  'SUCCESSOR_REQUIRED',
  'PERSONAL_LIST_LOCKED',
  'GIFT_SETTINGS_INCONSISTENT',
  'VISIBILITY_ENGAGED_PROFILE',
  'VISIBILITY_PROFILE_INVALID',
  'VERSION_MISMATCH',
  'PRODUCT_NOT_FOUND',
  'HIDDEN_ITEM_REQUIRES_CHOICE',
  'GLOBAL_CATALOG_UNAVAILABLE',
  'EXTRACTION_RATE_LIMITED',
  'IMAGE_REJECTED',
  'FETCHER_UNAVAILABLE',
  'PRODUCT_URL_INVALID',
  'ITEM_INVALID',
  'LIST_INVALID',
]);

/** Clé de message sous `lists.errors` ; jamais le texte du serveur. */
export function listErrorKey(error: unknown): string {
  if (error instanceof ApiError)
    return KNOWN.has(error.problem.code) ? error.problem.code : 'generic';
  return 'network';
}
