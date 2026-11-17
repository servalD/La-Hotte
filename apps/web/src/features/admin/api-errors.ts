import { ApiError } from '@wishlist/api-client';

/** Codes que l'espace d'administration sait expliquer (API-14) ; jamais le texte du serveur. */
const KNOWN = new Set([
  'VALIDATION_FAILED',
  'ACCOUNT_NOT_FOUND',
  'ADMIN_SELF_ACTION',
  'ROLE_REQUIREMENTS_NOT_MET',
  'LAST_ADMIN',
  'ACCOUNT_STATE_CONFLICT',
  'ACCOUNT_SEARCH_RATE_LIMITED',
  'SETTING_INVALID',
  'NOTHING_TO_MODERATE',
  'CONTEST_SAME_MODERATOR',
  'DECISION_NOT_FOUND',
  'REPORT_TARGET_NOT_FOUND',
]);

/** Clé sous `admin.errors`. */
export function adminErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    return KNOWN.has(error.problem.code) ? error.problem.code : 'generic';
  }
  return 'network';
}
