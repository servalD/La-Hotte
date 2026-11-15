/**
 * Nature d'une erreur métier. La présentation la traduit en statut HTTP (API-13) ;
 * le domaine ne connaît pas HTTP.
 */
export const DOMAIN_ERROR_KINDS = [
  'unauthenticated', // 401 — session absente, ou ré-authentification trop ancienne (AUTH-14)
  'not_found', // 404 — introuvable, ou interdit quand l'existence est un secret (SEC-04)
  'forbidden', // 403 — interdit, quand l'existence n'est pas un secret
  'conflict', // 409
  'precondition_failed', // 412 — version dépassée (API-17)
  'business_rule', // 422
  'locked', // 423 — profil verrouillé par PIN
  'rate_limited', // 429 — délai en cours (AUTH-07, API-18)
  'unavailable', // 503 — dépendance indisponible, refus en échec fermé (ADR 0013)
] as const;

export type DomainErrorKind = (typeof DOMAIN_ERROR_KINDS)[number];

/**
 * Erreur métier. `code` est stable et exploité par le client (API-14) : SCREAMING_SNAKE_CASE,
 * jamais renommé. `message` ne contient aucune donnée d'utilisateur ni détail interne.
 */
export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;
  abstract readonly code: string;

  /** Délai avant nouvel essai, pour `Retry-After` (429, 503). */
  readonly retryAfterSeconds?: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
