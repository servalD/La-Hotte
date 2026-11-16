import { ApiError } from '@wishlist/api-client';

/** Codes d'erreur des événements que l'interface sait expliquer (API-14). */
const KNOWN = new Set([
  'EVENT_NOT_FOUND',
  'EVENT_ACTION_FORBIDDEN',
  'EVENT_INVALID',
  'EVENT_DATE_PASSED',
  'EVENT_HONOREE_CANNOT_PARTICIPATE',
  'EVENT_PROFILE_NOT_ALLOWED',
  'EVENT_INVITATION_INVALID',
  'EVENT_CHILD_OUTSIDE_CIRCLE',
  'CARRY_NOT_ALLOWED',
  'VERSION_MISMATCH',
]);

/** Clé de message sous `events.errors` ; jamais le texte du serveur. */
export function eventErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    return KNOWN.has(error.problem.code) ? error.problem.code : 'generic';
  }
  return 'network';
}
