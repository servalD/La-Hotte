/**
 * Compte (AUTH-01, AUTH-02, AUTH-06, AUTH-08, AUTH-15, AUTH-16, PRO-01). Règles pures : e-mail,
 * mot de passe, jetons envoyés par e-mail, premier profil. Aucune entrée-sortie.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** AUTH-02 : 12 caractères au moins, 256 au plus (borne contre un hachage coûteux). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/** Longueur maximale d'une adresse (RFC 5321). */
export const EMAIL_MAX_LENGTH = 254;

/** PRO-02 : nom affiché du profil. */
export const DISPLAY_NAME_MAX_LENGTH = 60;

/** Longueur d'un mot de passe en caractères (points de code), pas en unités UTF-16. */
export function passwordLength(password: string): number {
  // Points de code voulus (pas de graphèmes) : la borne vise le coût du hachage, pas l'affichage.
  return Array.from(password).length;
}

export function isPasswordLengthValid(password: string): boolean {
  const length = passwordLength(password);
  return length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH;
}

/**
 * E-mail normalisé : espaces retirés, minuscules (l'index unique de `account.email` est donc
 * insensible à la casse, contrainte `account_email_normalized`). Sert aussi de clé de limitation :
 * une même adresse écrite autrement compte pour la même.
 */
export function normalizeEmail(raw: string): string {
  return raw.normalize('NFC').trim().toLowerCase();
}

export const ACCOUNT_TOKEN_PURPOSES = [
  'EMAIL_VERIFY',
  'EMAIL_CHANGE',
  'EMAIL_CHANGE_CANCEL',
  'PASSWORD_RESET',
] as const;
export type AccountTokenPurpose = (typeof ACCOUNT_TOKEN_PURPOSES)[number];

/** Durées des jetons envoyés par e-mail (`01`, « Valeurs par défaut »). */
export const ACCOUNT_TOKEN_LIFETIME_MS: Readonly<Record<AccountTokenPurpose, number>> = {
  EMAIL_VERIFY: 7 * DAY,
  EMAIL_CHANGE: DAY,
  EMAIL_CHANGE_CANCEL: 7 * DAY,
  PASSWORD_RESET: 30 * MINUTE,
};

/** AUTH-15 : un compte non vérifié est supprimé après 7 jours. */
export const UNVERIFIED_ACCOUNT_MAX_AGE_MS = 7 * DAY;

export const REGISTRATION_MODES = ['OPEN', 'INVITE_ONLY'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

/** Valeurs par défaut d'un profil (`01`, « Valeurs par défaut »). */
export const DEFAULT_LOCALE = 'fr';
export const DEFAULT_CURRENCY = 'EUR';
export const DEFAULT_TIMEZONE = 'Europe/Paris';

/** Couleurs d'accent d'un avatar sans image (PRO-02), contraste suffisant sur fond clair. */
export const ACCENT_COLORS = [
  '#b4432f',
  '#a0522d',
  '#2f6f4e',
  '#2b5c8a',
  '#5b4a9e',
  '#8a3b72',
  '#1f6f78',
  '#6b5b2a',
] as const;

/** Couleur d'accent tirée de l'identifiant du profil : stable, sans hasard dans le domaine. */
export function accentColorFor(profileId: string): string {
  const hex = profileId.replace(/[^0-9a-f]/gi, '');
  const index = parseInt(hex.slice(-2) || '0', 16) % ACCENT_COLORS.length;
  return ACCENT_COLORS[index] ?? ACCENT_COLORS[0];
}

/** État d'un compte utile à l'authentification. Le hash ne sort jamais du module. */
export interface AccountCredentials {
  readonly accountId: string;
  readonly email: string;
  readonly passwordHash: string | null;
  readonly active: boolean;
  readonly emailVerified: boolean;
  readonly totpEnabled: boolean;
}

/** Premier profil, créé avec le compte (PRO-01). */
export interface NewProfile {
  readonly id: string;
  readonly displayName: string;
  readonly accentColor: string;
  readonly locale: string;
  readonly currency: string;
  readonly timezone: string;
}

export interface NewAccount {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  /** AUTH-08 : déclaration « 15 ans ou plus », horodatée. */
  readonly ageAttestedAt: Date;
  readonly createdAt: Date;
  readonly profile: NewProfile;
  /** AUTH-09, LNK-08 : invitation à consommer à la vérification de l'e-mail. */
  readonly pendingInvitationId?: string | null;
}

export interface NewAccountToken {
  readonly id: string;
  readonly accountId: string;
  readonly purpose: AccountTokenPurpose;
  /** SHA-256 du jeton ; le jeton lui-même ne part que dans l'e-mail. */
  readonly tokenHash: string;
  /** Adresse à confirmer (`EMAIL_CHANGE`) ou à rétablir (`EMAIL_CHANGE_CANCEL`). */
  readonly newEmail: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface ConsumedAccountToken {
  readonly accountId: string;
  readonly purpose: AccountTokenPurpose;
  readonly newEmail: string | null;
  /** Émission du jeton : une annulation désarme les liens d'annulation émis après (AUTH-16). */
  readonly createdAt: Date;
}

export function tokenExpiry(purpose: AccountTokenPurpose, now: Date): Date {
  return new Date(now.getTime() + ACCOUNT_TOKEN_LIFETIME_MS[purpose]);
}
