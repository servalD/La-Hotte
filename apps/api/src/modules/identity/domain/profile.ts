/**
 * Profils et PIN (PRO-01 à PRO-08, PIN-01 à PIN-08). Règles pures : forme du PIN, attente après
 * des erreurs, champs modifiables. Aucune entrée-sortie.
 */
import type { PinRelock } from './session';

const MINUTE = 60_000;

/** PRO-01 : 10 profils au plus par compte (garanti aussi par un déclencheur en base). */
export const MAX_PROFILES_PER_ACCOUNT = 10;

/** PIN-01 : 4 à 8 chiffres. */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
const PIN_FORMAT = /^[0-9]{4,8}$/;

export function isPinWellFormed(pin: string): boolean {
  return PIN_FORMAT.test(pin);
}

/** PIN-03 : attente à partir de la 5ᵉ erreur consécutive. */
export const PIN_FAILURE_THRESHOLD = 5;

/**
 * PIN-03 : attente après la n-ième erreur consécutive : 1 minute après la 5ᵉ, 5 après la 6ᵉ, 15
 * après la 7ᵉ, puis une heure (plafond). L'adaptateur applique la même table dans son écriture
 * conditionnelle (`PIN_LOCK_STEPS_MS`).
 */
export const PIN_LOCK_STEPS_MS = [1 * MINUTE, 5 * MINUTE, 15 * MINUTE, 60 * MINUTE] as const;
const PIN_MAX_LOCK_MS = 60 * MINUTE;

export function pinLockDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures < PIN_FAILURE_THRESHOLD) return 0;
  const step = Math.min(consecutiveFailures - PIN_FAILURE_THRESHOLD, PIN_LOCK_STEPS_MS.length - 1);
  return PIN_LOCK_STEPS_MS[step] ?? PIN_MAX_LOCK_MS;
}

/** PRO-02. Bornes communes aux DTO et au domaine (mêmes formes qu'à l'inscription). */
export const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
export const TIMEZONE_MAX_LENGTH = 64;

/** Profil tel que le voit son titulaire (`GET /profiles/me`). Jamais le hash du PIN. */
export interface ProfileDetails {
  readonly id: string;
  readonly accountId: string;
  readonly displayName: string;
  /** Clé d'image ; `null` : couleur d'accent et initiales (PRO-02). */
  readonly avatar: string | null;
  readonly accentColor: string;
  readonly birthdayDay: number | null;
  readonly birthdayMonth: number | null;
  readonly birthdayYear: number | null;
  readonly locale: string;
  readonly currency: string;
  readonly timezone: string;
  readonly isChild: boolean;
  readonly hasPin: boolean;
  readonly pinRelock: PinRelock;
  /** PIN-05 : PIN réinitialisé ou désactivé depuis l'espace Compte, tant que le profil ne s'en est pas redonné un. */
  readonly pinResetNoticeAt: Date | null;
  /** PRO-10 : adresse vérifiée du profil, rendue au seul profil ; `null` sans adresse. */
  readonly email: string | null;
  readonly version: number;
}

/** PIN-07 : force croissante du reverrouillage ; l'affaiblir exige le PIN courant (PRO-03). */
const RELOCK_STRENGTH: Readonly<Record<PinRelock, number>> = {
  NEVER: 0,
  IDLE_15: 1,
  EVERY_OPEN: 2,
};

export function weakensRelock(from: PinRelock, to: PinRelock): boolean {
  return RELOCK_STRENGTH[to] < RELOCK_STRENGTH[from];
}

/**
 * Métadonnées d'un profil pour l'espace Compte (PIN-08, ADR 0013) : identifiant, nom, avatar,
 * présence d'un PIN, marqueur enfant. Rien d'autre.
 */
export interface ProfileMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly avatar: string | null;
  readonly accentColor: string;
  readonly hasPin: boolean;
  readonly isChild: boolean;
  /** PRO-10 : le profil a une adresse vérifiée (jamais l'adresse : elle n'est rendue qu'à lui). */
  readonly hasEmail: boolean;
}

/**
 * PRO-03 : champs modifiables depuis le profil. Le marqueur enfant n'en fait pas partie : un
 * enfant le retirerait pour échapper à PRO-05.
 */
export interface ProfileChanges {
  readonly displayName?: string;
  readonly birthday?: {
    readonly day: number;
    readonly month: number;
    readonly year: number | null;
  } | null;
  readonly locale?: string;
  readonly currency?: string;
  readonly timezone?: string;
  readonly pinRelock?: PinRelock;
}

/** PRO-02 : jour cohérent avec le mois (29 février accepté sans année ou en année bissextile). */
export function isBirthdayValid(day: number, month: number, year: number | null): boolean {
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12) return false;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) return false;
  // Année bissextile de référence quand l'année est inconnue : le 29 février reste possible.
  const reference = year ?? 2000;
  const daysInMonth = new Date(Date.UTC(reference, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

/** Fuseau IANA reconnu par le moteur (PRO-02). */
export function isTimezoneValid(timezone: string): boolean {
  if (timezone.length === 0 || timezone.length > TIMEZONE_MAX_LENGTH) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Nom affiché : espaces de bord retirés, non vide (contrainte `profile_display_name_not_blank`). */
export function normalizeDisplayName(raw: string): string {
  return raw.normalize('NFC').trim();
}

/**
 * Issue d'un essai de PIN, déjà compté par l'adaptateur (PIN-03).
 * - `locked` : attente en cours, l'essai n'est pas évalué ;
 * - `no_pin` : le profil n'a pas de PIN ;
 * - `counted` : l'essai est compté comme une erreur jusqu'à preuve du contraire ; `failures` est le
 *   nombre d'erreurs consécutives, celui-ci compris ; `pinStamp` : empreinte du hash (PIN-05),
 *   calculée par l'adaptateur seul, la même que lit la garde.
 */
export type PinAttempt =
  | { readonly kind: 'locked'; readonly retryAfterMs: number }
  | { readonly kind: 'no_pin' }
  | {
      readonly kind: 'counted';
      readonly pinHash: string;
      readonly pinStamp: string;
      readonly failures: number;
    };
