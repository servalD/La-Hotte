import { DomainError } from '../../../shared/domain';

/** PRO-15 : un compte sous tutelle n'a que des profils enfants, et ne change pas de marqueur. */
export class WardChildOnlyError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'WARD_CHILD_ONLY';

  constructor() {
    super('Ce compte est sous tutelle : ses profils restent des profils enfants.');
  }
}

/**
 * PRO-12, PRO-15 : le changement laisserait un compte (hors tutelle) avec des enfants seuls, ou un
 * enfant d'un compte sous tutelle sans tuteur.
 */
export class GuardianRequiredError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'GUARDIAN_REQUIRED';

  constructor() {
    super('Un profil enfant doit garder un adulte responsable.');
  }
}

/** PRO-16, SEC-04 : compte sous tutelle inconnu, ou d'un autre tuteur, sans distinction. */
export class WardNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'WARD_NOT_FOUND';

  constructor() {
    super('Compte introuvable.');
  }
}

/**
 * PRO-15 : lien d'installation inconnu, expiré, déjà servi, ou adresse déjà inscrite : un seul
 * refus, qui ne dit pas lequel (AUTH-09).
 */
export class AccountSetupInvalidError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'ACCOUNT_SETUP_INVALID';

  constructor() {
    super('Ce lien n’est pas valable.');
  }
}

/** PRO-16 : la tutelle ne se lève que pour un compte à un seul profil. */
export class WardReleaseSingleProfileError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'WARD_RELEASE_SINGLE_PROFILE';

  constructor() {
    super('La tutelle ne se lève que pour un compte à un seul profil.');
  }
}

/** PRO-16 : déclaration d'âge sans levée demandée par le tuteur. */
export class WardReleaseNotRequestedError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'WARD_RELEASE_NOT_REQUESTED';

  constructor() {
    super('Aucune levée de tutelle n’est demandée pour ce compte.');
  }
}
