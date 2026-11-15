import { ApiError } from '@wishlist/api-client';

/** Codes d'erreur de l'API que les écrans d'accès savent expliquer (API-14). */
const KNOWN = new Set([
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED',
  'ACCOUNT_SUSPENDED',
  'RATE_LIMITED',
  'PASSWORD_BREACHED',
  'PASSWORD_LENGTH',
  'AGE_ATTESTATION_REQUIRED',
  'INVITATION_REQUIRED',
  'INVITATION_INVALID',
  'TOKEN_INVALID',
  'SERVICE_UNAVAILABLE',
  'TOTP_ENROLLMENT_REQUIRED',
  'REAUTH_REQUIRED',
  'INVALID_SECOND_FACTOR',
  'TOTP_ALREADY_ENABLED',
  'TOTP_NOT_ENABLED',
  'TOTP_ENROLLMENT_MISSING',
  'TOTP_MANDATORY',
  'LAST_PROFILE',
  'PROFILE_LIMIT_REACHED',
  'PIN_NOT_SET',
  'CURRENT_PIN_REQUIRED',
  'PIN_INVALID',
  'PIN_RATE_LIMITED',
  'EMAIL_TOO_RECENT',
  'VERSION_MISMATCH',
  'CHILD_EMAIL_FORBIDDEN',
  'LINK_NOT_FOUND',
  'BLOCK_SELF',
  'INVITATION_LIMIT_REACHED',
  'INVITATION_TARGET_INVALID',
  'PROFILE_INVITATION_FORBIDDEN',
  'PROFILE_PROPOSAL_PENDING',
  'GOOGLE_ALREADY_LINKED',
  'GOOGLE_NOT_LINKED',
  'GOOGLE_UNAVAILABLE',
  'GOOGLE_IDENTITY_TAKEN',
  'PROFILE_NOT_FOUND',
  'SESSION_NOT_FOUND',
  'TRUSTED_DEVICE_NOT_FOUND',
  'TRANSFER_INVALID',
  'TRANSFER_CONSENT_UNSAFE',
  'TRANSFER_PENDING',
  'TRANSFER_PIN_CHOICE_INVALID',
  'DETACH_CHILD_FORBIDDEN',
  'DETACH_EMAIL_REQUIRED',
  'UNDECLARED_REGROUP',
  'HAS_WARDS',
  'GUARDIAN_REQUIRED',
  'WARD_CHILD_ONLY',
  'WARD_NOT_FOUND',
  'WARD_RELEASE_NOT_REQUESTED',
  'WARD_RELEASE_SINGLE_PROFILE',
  'ACCOUNT_SETUP_INVALID',
  'INVALID_PROFILE',
  'LINK_SAME_ACCOUNT',
  'PROFILE_LOCKED',
]);

/** Clé de message (sous `auth.errors`) pour une erreur ; jamais le texte du serveur. */
export function authErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (KNOWN.has(error.problem.code)) return error.problem.code;
    if (error.status === 429) return 'RATE_LIMITED';
    return 'generic';
  }
  return 'network';
}

/** Un mot de passe est rejeté par le serveur (liste de fuites, longueur) : l'erreur va au champ. */
export function isPasswordError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.problem.code === 'PASSWORD_BREACHED' || error.problem.code === 'PASSWORD_LENGTH')
  );
}
