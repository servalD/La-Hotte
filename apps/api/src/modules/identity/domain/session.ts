/**
 * Session (AUTH-04, AUTH-05, ADR 0013). Règles pures : durées, validité, déverrouillage du profil
 * actif, ré-authentification. Aucune entrée-sortie.
 */

export const ACCOUNT_ROLES = ['USER', 'MODERATOR', 'ADMIN'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const PIN_RELOCK_MODES = ['NEVER', 'IDLE_15', 'EVERY_OPEN'] as const;
export type PinRelock = (typeof PIN_RELOCK_MODES)[number];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Durées glissante et absolue selon le rôle (AUTH-04, AUTH-05). */
export function sessionLifetime(role: AccountRole): { slidingMs: number; absoluteMs: number } {
  return role === 'USER'
    ? { slidingMs: 30 * DAY, absoluteMs: 90 * DAY }
    : { slidingMs: 12 * HOUR, absoluteMs: 24 * HOUR };
}

/** Durée de la marque de révocation : la plus longue durée absolue, quel que soit le rôle. */
export const REVOCATION_MARK_MS = 90 * DAY;

/** `last_seen_at` et `expires_at` recopiés en base au plus toutes les 5 minutes. */
export const PERSIST_INTERVAL_MS = 5 * MINUTE;

/** Reverrouillage par inactivité (PIN-07, `IDLE_15`). */
export const UNLOCK_IDLE_MS = 15 * MINUTE;

/** Ré-authentification (AUTH-14) : 10 minutes, 2 minutes pour réinitialiser ou désactiver un PIN. */
export const REAUTH_MAX_AGE_MS = 10 * MINUTE;
export const REAUTH_PIN_MAX_AGE_MS = 2 * MINUTE;

/** Ligne de session, telle qu'en base. `role` est celui du compte. */
export interface SessionRecord {
  readonly id: string;
  readonly accountId: string;
  readonly role: AccountRole;
  /** SHA-256 du jeton, hexadécimal. Ne sort jamais du serveur. */
  readonly tokenHash: string;
  readonly authEpoch: number;
  readonly activeProfileId: string | null;
  readonly reauthAt: Date | null;
  readonly trustedDeviceId: string | null;
  readonly userAgent: string;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly createdAt: Date;
}

/**
 * Déverrouillage du profil actif (PIN-02). Tenu dans le cache seulement, jamais en base : une
 * session relue depuis PostgreSQL n'en a pas (ADR 0013).
 */
export interface Unlock {
  readonly profileId: string;
  /** Dernière action de l'utilisateur (`X-User-Activity`) ou saisie du PIN. */
  readonly at: Date;
  /** `EVERY_OPEN` : nonce comparé au cookie `__Host-lh_unlock`. */
  readonly nonce: string | null;
}

/** Session telle que lue dans le cache. */
export interface CachedSession {
  readonly record: SessionRecord;
  readonly unlock: Unlock | null;
  /** Dernière recopie de `last_seen_at` et `expires_at` en base. */
  readonly persistedAt: Date;
}

export type SessionRejection = 'epoch' | 'expired' | 'absolute' | 'inactive_account';

/** Validité d'une session : époque du compte, durée glissante, durée absolue (ADR 0013). */
export function rejectSession(
  record: SessionRecord,
  accountEpoch: number,
  now: Date,
): SessionRejection | null {
  if (record.authEpoch !== accountEpoch) return 'epoch';
  if (now.getTime() >= record.absoluteExpiresAt.getTime()) return 'absolute';
  if (now.getTime() >= record.expiresAt.getTime()) return 'expired';
  return null;
}

/** Nouvelle échéance glissante, jamais au-delà de la durée absolue. */
export function slideExpiry(record: SessionRecord, now: Date): Date {
  const { slidingMs } = sessionLifetime(record.role);
  return new Date(Math.min(now.getTime() + slidingMs, record.absoluteExpiresAt.getTime()));
}

/** Échéances d'une session neuve. */
export function newSessionExpiry(
  role: AccountRole,
  now: Date,
): { expiresAt: Date; absoluteExpiresAt: Date } {
  const { slidingMs, absoluteMs } = sessionLifetime(role);
  return {
    expiresAt: new Date(now.getTime() + slidingMs),
    absoluteExpiresAt: new Date(now.getTime() + absoluteMs),
  };
}

/** Réglage de verrouillage d'un profil. */
export interface ProfileLockPolicy {
  readonly profileId: string;
  readonly accountId: string;
  readonly hasPin: boolean;
  readonly relock: PinRelock;
}

/** Comparaison en temps constant de deux chaînes (nonce de déverrouillage). */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * PIN-02, PIN-07 : le profil actif est-il déverrouillé ? Un profil sans PIN l'est toujours.
 * Sinon, il faut un déverrouillage du même profil, récent pour `IDLE_15` et `EVERY_OPEN`, et pour
 * `EVERY_OPEN` le cookie de déverrouillage du navigateur.
 */
export function isProfileUnlocked(input: {
  readonly policy: ProfileLockPolicy;
  readonly unlock: Unlock | null;
  readonly unlockCookie: string | null;
  readonly now: Date;
}): boolean {
  const { policy, unlock, unlockCookie, now } = input;
  if (!policy.hasPin) return true;
  if (!unlock || unlock.profileId !== policy.profileId) return false;
  if (policy.relock !== 'NEVER' && now.getTime() - unlock.at.getTime() >= UNLOCK_IDLE_MS) {
    return false;
  }
  if (policy.relock === 'EVERY_OPEN') {
    return unlock.nonce !== null && unlockCookie !== null && sameSecret(unlock.nonce, unlockCookie);
  }
  return true;
}

/** AUTH-14 : ré-authentification datant de moins de `maxAgeMs`. */
export function hasRecentReauth(reauthAt: Date | null, now: Date, maxAgeMs: number): boolean {
  if (!reauthAt) return false;
  const age = now.getTime() - reauthAt.getTime();
  return age >= 0 && age < maxAgeMs;
}
