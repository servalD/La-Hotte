/**
 * Limitation des tentatives (AUTH-07, ADR 0013 « Limitation »). Politique pure ; le comptage
 * atomique est fait par l'adaptateur du port `RateLimiter`.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Portées de l'ADR 0013, seuils dans `01` (« Valeurs par défaut »). Le PIN s'ajoutera avec la
 * tranche 5, seuil écrit d'abord dans la spec.
 */
export const RATE_LIMIT_SCOPES = [
  'login_pair', // couple (e-mail, IP)
  'login_account', // e-mail seul
  'login_ip', // IP seule, tous comptes confondus
  'second_factor', // second facteur, par compte seul
  'reauth', // ré-authentification, par compte
  'register_ip', // demandes d'inscription, par IP
  'reset_ip', // demandes de réinitialisation, par IP
  'mail_recipient', // envois d'e-mail, par adresse destinataire (jamais de 429)
] as const;
export type RateLimitScope = (typeof RATE_LIMIT_SCOPES)[number];

export interface RateLimitPolicy {
  /** Nombre d'échecs à partir duquel le délai s'applique. */
  readonly threshold: number;
  /** Fenêtre glissante : un échec plus ancien ne compte plus. */
  readonly windowMs: number;
  /** Un succès remet ce compteur à zéro. Jamais vrai pour un compteur qu'un tiers peut vider. */
  readonly resetOnSuccess: boolean;
}

export const RATE_LIMIT_POLICIES: Readonly<Record<RateLimitScope, RateLimitPolicy>> = {
  login_pair: { threshold: 5, windowMs: 24 * HOUR, resetOnSuccess: true },
  // Fenêtres d'une heure, jamais vidées par un succès : un attaquant ne les remet pas à zéro en
  // se connectant à son propre compte.
  login_account: { threshold: 20, windowMs: HOUR, resetOnSuccess: false },
  login_ip: { threshold: 50, windowMs: HOUR, resetOnSuccess: false },
  // Remis à zéro par un succès du second facteur seulement (ADR 0013, « Pré-authentification »).
  second_factor: { threshold: 5, windowMs: 24 * HOUR, resetOnSuccess: true },
  reauth: { threshold: 5, windowMs: 24 * HOUR, resetOnSuccess: true },
  // Demandes, pas échecs : chaque demande est comptée.
  register_ip: { threshold: 10, windowMs: HOUR, resetOnSuccess: false },
  reset_ip: { threshold: 10, windowMs: HOUR, resetOnSuccess: false },
  mail_recipient: { threshold: 3, windowMs: 24 * HOUR, resetOnSuccess: false },
};

/** Seuil du compteur par compte depuis un appareil de confiance du compte (ADR 0013). */
export const TRUSTED_DEVICE_ACCOUNT_THRESHOLD = 50;

export const RATE_LIMIT_BASE_DELAY_MS = SECOND;
export const RATE_LIMIT_MAX_DELAY_MS = 15 * MINUTE;

/**
 * Délai croissant : 1 s au seuil, puis 2 s, 4 s… plafonné à 15 minutes. Jamais de blocage
 * définitif (AUTH-07).
 */
export function rateLimitDelayMs(failures: number, threshold: number): number {
  if (failures < threshold) return 0;
  const exponent = Math.min(failures - threshold, 30);
  return Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** exponent, RATE_LIMIT_MAX_DELAY_MS);
}

/**
 * Sujet d'un compteur. Les parties (e-mail normalisé, adresse IP, identifiant de compte) ne sont
 * jamais stockées telles quelles : l'adaptateur en fait un HMAC à clé serveur.
 */
export interface RateLimitSubject {
  readonly scope: RateLimitScope;
  readonly parts: readonly string[];
  /** Seuil propre à cette vérification (appareil de confiance) ; sinon celui de la politique. */
  readonly threshold?: number;
}
