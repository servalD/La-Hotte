/**
 * Limitation des tentatives (AUTH-07, ADR 0013 « Limitation »). Politique pure ; le comptage
 * atomique est fait par l'adaptateur du port `RateLimiter`.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Portées fixées par l'ADR 0013. Les autres (ré-authentification, réinitialisation, inscription,
 * PIN, envois d'e-mail par destinataire) s'ajoutent avec la tranche qui les utilise, seuils
 * écrits d'abord dans la spec.
 */
export const RATE_LIMIT_SCOPES = [
  'login_pair', // couple (compte, IP)
  'login_account', // compte seul
  'login_ip', // IP seule, tous comptes confondus
  'second_factor', // second facteur, par compte seul
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
