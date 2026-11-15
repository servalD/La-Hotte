import { DomainError } from '../../../shared/domain';

/** SEC-04 : profil inconnu ou d'un autre compte, sans distinction. */
export class ProfileNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'PROFILE_NOT_FOUND';

  constructor() {
    super('Profil introuvable.');
  }
}

/** PIN-02, PRO-07 : PIN faux (l'essai est compté, PIN-03). */
export class PinInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'PIN_INVALID';

  constructor() {
    super('Code PIN incorrect.');
  }
}

/** PIN-03 : attente en cours, l'essai n'est pas évalué (compté à part comme refus, OBS-02). */
export class PinRateLimitedError extends DomainError {
  readonly kind = 'rate_limited';
  readonly code = 'PIN_RATE_LIMITED';
  override readonly retryAfterSeconds: number;

  constructor(retryAfterMs: number) {
    super('Trop de codes PIN erronés. Réessayez plus tard.');
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  }
}

/** PIN-04, PRO-03 : le profil a déjà un PIN, il est exigé pour le changer ou affaiblir le reverrouillage. */
export class CurrentPinRequiredError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'CURRENT_PIN_REQUIRED';

  constructor() {
    super('Saisissez votre code PIN actuel.');
  }
}

/** PIN-05 : rien à désactiver ni à réinitialiser sur un profil sans PIN. */
export class PinNotSetError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'PIN_NOT_SET';

  constructor() {
    super('Ce profil n’a pas de code PIN.');
  }
}

/** PRO-01, PRO-08 : 10 profils au plus. */
export class ProfileLimitReachedError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'PROFILE_LIMIT_REACHED';

  constructor() {
    super('Un compte compte 10 profils au plus.');
  }
}

/** PRO-01, PRO-08 : un compte garde au moins un profil. */
export class LastProfileError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'LAST_PROFILE';

  constructor() {
    super('Le dernier profil d’un compte ne peut pas être supprimé.');
  }
}

/** PRO-02 : date d'anniversaire impossible, fuseau inconnu, nom vide. */
export class InvalidProfileError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'INVALID_PROFILE';

  constructor() {
    super('Une information du profil n’est pas valable.');
  }
}

/** API-17 : version dépassée ; le client relit le profil. */
export class ProfileVersionMismatchError extends DomainError {
  readonly kind = 'precondition_failed';
  readonly code = 'VERSION_MISMATCH';

  constructor() {
    super('Ce profil a été modifié entre-temps.');
  }
}
