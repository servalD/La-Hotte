import { DomainError } from '../../../shared/domain';

/** AUTH-10, AUTH-14 : code TOTP ou de secours refusé (faux, déjà utilisé, ou hors fenêtre). */
export class InvalidSecondFactorError extends DomainError {
  readonly kind = 'unauthenticated';
  readonly code = 'INVALID_SECOND_FACTOR';

  constructor() {
    super('Code incorrect ou déjà utilisé.');
  }
}

/**
 * ADR 0013 : pré-authentification absente, expirée (5 minutes) ou invalidée (réinitialisation du
 * mot de passe). Le client recommence la connexion.
 */
export class SecondFactorExpiredError extends DomainError {
  readonly kind = 'unauthenticated';
  readonly code = 'SECOND_FACTOR_EXPIRED';

  constructor() {
    super('Connexion expirée. Saisissez de nouveau votre mot de passe.');
  }
}

/** AUTH-14 : le TOTP est actif, la ré-authentification doit porter un code. */
export class SecondFactorRequiredError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'SECOND_FACTOR_REQUIRED';

  constructor() {
    super('Saisissez aussi le code de votre application d’authentification.');
  }
}

/**
 * AUTH-13 : compte administrateur ou modérateur sans TOTP. Refus en échec fermé à la connexion :
 * le TOTP s'active avant que le rôle soit attribué.
 */
export class SecondFactorEnrollmentRequiredError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'TOTP_ENROLLMENT_REQUIRED';

  constructor() {
    super('Ce compte doit activer la double authentification avant de se connecter.');
  }
}

/** AUTH-13 : un administrateur ou un modérateur ne désactive pas son TOTP. */
export class SecondFactorMandatoryError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'TOTP_MANDATORY';

  constructor() {
    super('La double authentification est obligatoire pour ce compte.');
  }
}

export class TotpAlreadyEnabledError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'TOTP_ALREADY_ENABLED';

  constructor() {
    super('La double authentification est déjà active.');
  }
}

export class TotpNotEnabledError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'TOTP_NOT_ENABLED';

  constructor() {
    super('La double authentification n’est pas active.');
  }
}

/** Activation sans inscription en cours, ou inscription remplacée par une autre entre-temps. */
export class TotpEnrollmentMissingError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'TOTP_ENROLLMENT_MISSING';

  constructor() {
    super('Recommencez l’activation : affichez un nouveau QR code.');
  }
}

/** AUTH-15 : un compte non vérifié n'active pas le TOTP. */
export class EmailNotVerifiedError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'EMAIL_NOT_VERIFIED';

  constructor() {
    super('Confirmez d’abord votre adresse e-mail.');
  }
}

/** Appareil de confiance inconnu ou d'un autre compte (SEC-04 : pas de distinction). */
export class TrustedDeviceNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'TRUSTED_DEVICE_NOT_FOUND';

  constructor() {
    super('Appareil introuvable.');
  }
}
