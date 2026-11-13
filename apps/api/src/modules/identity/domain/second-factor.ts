/**
 * Second facteur (AUTH-10 à AUTH-14, ADR 0013 « Pré-authentification »). Règles pures : forme des
 * codes, durées, rôles qui l'exigent. Aucune entrée-sortie.
 */
import type { AccountRole } from './session';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** AUTH-10 : RFC 6238, 6 chiffres, pas de 30 secondes. */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** ADR 0003 : un pas d'écart toléré de part et d'autre (horloge du téléphone). */
export const TOTP_TOLERANCE_STEPS = 1;
/** Nom affiché par l'application d'authentification. */
export const TOTP_ISSUER = 'La Hotte';

/** AUTH-10 : 10 codes de secours, 80 bits chacun, affichés une seule fois. */
export const RECOVERY_CODE_COUNT = 10;
/** 16 caractères base32 de Crockford (5 bits chacun) : 80 bits. */
export const RECOVERY_CODE_LENGTH = 16;

/** ADR 0013 : la pré-authentification vit 5 minutes. */
export const PENDING_SECOND_FACTOR_TTL_MS = 5 * MINUTE;
/** AUTH-12 : appareil de confiance pendant 30 jours. */
export const TRUSTED_DEVICE_LIFETIME_MS = 30 * DAY;

/** AUTH-13 : rôles pour lesquels le TOTP est obligatoire. */
export function requiresSecondFactor(role: AccountRole): boolean {
  return role === 'ADMIN' || role === 'MODERATOR';
}

const TOTP_CODE = /^\d{6}$/;

/** Code TOTP saisi : chiffres seuls, espaces tolérés (« 123 456 »). `null` s'il n'en est pas un. */
export function normalizeTotpCode(raw: string): string | null {
  const code = raw.replace(/\s/g, '');
  return TOTP_CODE.test(code) ? code : null;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Code de secours saisi : tirets et espaces retirés, majuscules, lettres ambiguës ramenées à leur
 * chiffre (O → 0, I et L → 1), comme le prévoit le base32 de Crockford. `null` s'il n'en est pas un.
 */
export function normalizeRecoveryCode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  if (code.length !== RECOVERY_CODE_LENGTH) return null;
  for (const char of code) if (!CROCKFORD.includes(char)) return null;
  return code;
}

/** 10 octets aléatoires → 16 caractères de Crockford (80 bits). */
export function encodeRecoveryCode(bytes: Uint8Array): string {
  if (bytes.length !== 10) throw new Error('Un code de secours demande 10 octets');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  return out;
}

/** Forme affichée : quatre groupes de quatre (« 7K2M-…-…-… »). */
export function formatRecoveryCode(code: string): string {
  return code.match(/.{4}/g)?.join('-') ?? code;
}

/**
 * Code reçu par la vérification du second facteur : un code TOTP à 6 chiffres ou un code de
 * secours. `null` si la forme n'est ni l'une ni l'autre.
 */
export type SecondFactorCode =
  | { readonly kind: 'totp'; readonly code: string }
  | { readonly kind: 'recovery'; readonly code: string };

export function parseSecondFactorCode(raw: string): SecondFactorCode | null {
  const totp = normalizeTotpCode(raw);
  if (totp) return { kind: 'totp', code: totp };
  const recovery = normalizeRecoveryCode(raw);
  return recovery ? { kind: 'recovery', code: recovery } : null;
}

/**
 * Pré-authentification (ADR 0013) : le mot de passe est validé, le second facteur attendu. Ne
 * permet que l'appel de vérification ; porte l'époque du compte, qu'une réinitialisation change.
 */
export interface PendingSecondFactor {
  readonly accountId: string;
  readonly epoch: number;
  readonly createdAt: Date;
}

/** Secret TOTP en attente d'activation ou actif. */
export interface TotpState {
  /** Secret chiffré (SEC-22) ; `null` si aucune inscription n'est en cours ni active. */
  readonly secretEnc: Uint8Array | null;
  readonly enabled: boolean;
  /** Dernier pas accepté (AUTH-11). */
  readonly lastStep: number | null;
}

export interface TrustedDeviceSummary {
  readonly id: string;
  readonly userAgent: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface NewTrustedDevice extends TrustedDeviceSummary {
  readonly accountId: string;
  readonly tokenHash: string;
}
