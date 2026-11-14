import { DomainError } from '../../../shared/domain';

/** SEC-01 : session absente, expirée ou révoquée. */
export class SessionRequiredError extends DomainError {
  readonly kind = 'unauthenticated';
  readonly code = 'UNAUTHENTICATED';

  constructor() {
    super('Connexion requise.');
  }
}

/** API-21, ADR 0013 : origine étrangère ou jeton CSRF absent ou invalide. */
export class CsrfRejectedError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'CSRF_REJECTED';

  constructor() {
    super('Requête refusée : rechargez la page puis réessayez.');
  }
}

/** PIN-02 : aucun profil actif, ou profil actif verrouillé. */
export class ProfileLockedError extends DomainError {
  readonly kind = 'locked';
  readonly code = 'PROFILE_LOCKED';

  constructor() {
    super('Ce profil est verrouillé.');
  }
}

/** AUTH-14 : ré-authentification absente ou trop ancienne. */
export class ReauthRequiredError extends DomainError {
  readonly kind = 'unauthenticated';
  readonly code = 'REAUTH_REQUIRED';

  constructor() {
    super('Confirmez votre identité pour continuer.');
  }
}

/** AUTH-07, API-18 : délai en cours, la tentative n'est pas évaluée. */
export class RateLimitedError extends DomainError {
  readonly kind = 'rate_limited';
  readonly code = 'RATE_LIMITED';
  override readonly retryAfterSeconds: number;

  constructor(retryAfterMs: number) {
    super('Trop de tentatives. Réessayez plus tard.');
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  }
}

/** ADR 0013 : stockage de session ou limiteur indisponible, refus en échec fermé. */
export class IdentityUnavailableError extends DomainError {
  readonly kind = 'unavailable';
  readonly code = 'SERVICE_UNAVAILABLE';
  override readonly retryAfterSeconds = 5;

  constructor() {
    super('Service momentanément indisponible.');
  }
}
