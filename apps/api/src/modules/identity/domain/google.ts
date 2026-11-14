/**
 * Connexion par Google (AUTH-01, AUTH-03, AUTH-12, AUTH-14, AUTH-15, ADR 0013 « Retour OIDC »).
 * Règles pures : parcours, durées, décision à partir des affirmations de Google. Aucune
 * entrée-sortie.
 */

const MINUTE = 60_000;

/** ADR 0013 : `state`, `nonce` et `code_verifier` gardés côté serveur 10 minutes. */
export const OIDC_FLOW_TTL_MS = 10 * MINUTE;

/** AUTH-14 : retour de Google en attente du code TOTP, 5 minutes. */
export const GOOGLE_REAUTH_PROOF_TTL_MS = 5 * MINUTE;

/**
 * AUTH-14 : une ré-authentification par Google exige une authentification fraîche. Google reçoit
 * `max_age=0` ; `auth_time` doit dater de moins de 5 minutes au retour.
 */
export const GOOGLE_REAUTH_MAX_AGE_SECONDS = 300;

/** `sub` d'OpenID Connect (OIDC Core, 2) : ASCII imprimable, 255 caractères au plus. */
const SUBJECT_FORMAT = /^[\x21-\x7e]{1,255}$/;

/** Ce que l'application retient de Google : identifiant et adresse, rien d'autre (RGPD-02). */
export interface GoogleClaims {
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  /** `auth_time` : instant de la dernière authentification chez Google, s'il est donné. */
  readonly authTime: Date | null;
}

/** Tolérance d'horloge entre Google et le serveur. */
const CLOCK_TOLERANCE_MS = 30_000;

/**
 * AUTH-14 : authentification faite chez Google **après** le départ du parcours (à la tolérance
 * d'horloge près). Sans `auth_time`, non.
 */
export function isFreshFor(authTime: Date | null, flowCreatedAt: Date): boolean {
  return authTime !== null && authTime.getTime() >= flowCreatedAt.getTime() - CLOCK_TOLERANCE_MS;
}

/**
 * Forme plausible d'une adresse : une seule `@`, un domaine avec un point, ni espace ni caractère
 * de contrôle. L'adresse Google devient l'e-mail du compte et un destinataire d'envoi.
 */
// eslint-disable-next-line no-control-regex -- refus explicite des caractères de contrôle
const PLAUSIBLE_EMAIL = /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/;

export function isPlausibleEmail(email: string): boolean {
  return PLAUSIBLE_EMAIL.test(email);
}

export function isValidSubject(subject: string): boolean {
  return SUBJECT_FORMAT.test(subject);
}

/** AUTH-03, AUTH-08 : saisi avant le départ vers Google, utilisé seulement si aucun compte n'existe. */
export interface GoogleRegistration {
  readonly displayName: string;
  readonly locale: string | null;
  readonly timezone: string | null;
  /**
   * AUTH-09, LNK-08 : SHA-256 du jeton d'invitation présenté au départ (jamais le jeton lui-même
   * dans l'état Redis du parcours). Validé au retour, à la création du compte.
   */
  readonly invitationTokenHash: string | null;
}

/**
 * Parcours en cours, lié à ce qui l'a démarré (ADR 0013) :
 * - `login` : connexion ou inscription, liée au hash de l'identifiant de pré-session ;
 * - `link` : association, liée à `session.id` et à l'époque du compte ;
 * - `reauth` : ré-authentification, liée de même.
 */
export type OidcFlowKind = 'login' | 'link' | 'reauth';

export interface OidcFlow {
  readonly kind: OidcFlowKind;
  /** `login` : SHA-256 de l'identifiant de pré-session ; sinon `session.id`. */
  readonly binding: string;
  /** `link` et `reauth` : compte de la session, et son époque au démarrage. */
  readonly accountId: string | null;
  readonly epoch: number | null;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly registration: GoogleRegistration | null;
  readonly createdAt: Date;
}

/** AUTH-14 : retour de Google validé, en attente du code TOTP, lié à une session. */
export interface GoogleReauthProof {
  readonly tokenHash: string;
  readonly epoch: number;
  readonly createdAt: Date;
}

/**
 * Connexion Google sans identité connue (AUTH-03, AUTH-15) : que faire de l'adresse ?
 * - `unverified_email` : Google ne garantit pas l'adresse, rien n'est créé ni remplacé ;
 * - `link_required` : un compte vérifié l'a déjà, jamais de fusion automatique ;
 * - `unavailable` : réservée par un lien d'annulation d'un changement d'adresse (AUTH-16) ;
 * - `replace` : compte local non vérifié de même adresse, remplacé (AUTH-15) ;
 * - `create` : adresse libre.
 */
export type NewGoogleAccountDecision =
  'unverified_email' | 'link_required' | 'unavailable' | 'replace' | 'create';

export function decideNewGoogleAccount(input: {
  readonly claims: GoogleClaims;
  readonly existing: { readonly emailVerified: boolean } | null;
  readonly reserved: boolean;
}): NewGoogleAccountDecision {
  if (!input.claims.emailVerified || !input.claims.email) return 'unverified_email';
  if (!isPlausibleEmail(input.claims.email)) return 'unavailable';
  if (input.existing) return input.existing.emailVerified ? 'link_required' : 'replace';
  if (input.reserved) return 'unavailable';
  return 'create';
}

/** Issue d'un retour de Google, transmise au client par la page de retour du web. */
export const GOOGLE_RETURN_STATUSES = [
  'signed_in',
  'second_factor',
  'linked',
  'reauthenticated',
  'reauth_second_factor',
] as const;
export type GoogleReturnStatus = (typeof GOOGLE_RETURN_STATUSES)[number];
