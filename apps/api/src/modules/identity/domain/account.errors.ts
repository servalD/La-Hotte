import { DomainError } from '../../../shared/domain';

/**
 * Identifiants refusés (AUTH-07, ADR 0013 « Anti-énumération ») : même réponse que le compte
 * existe ou non, qu'il ait un mot de passe ou non.
 */
export class InvalidCredentialsError extends DomainError {
  readonly kind = 'unauthenticated';
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('E-mail ou mot de passe incorrect, ou adresse pas encore confirmée.');
  }
}

/** Compte suspendu : révélé seulement après un mot de passe juste. */
export class AccountSuspendedError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'ACCOUNT_SUSPENDED';

  constructor() {
    super('Ce compte est suspendu.');
  }
}

/** AUTH-02 : mot de passe présent dans les fuites connues. */
export class PasswordBreachedError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'PASSWORD_BREACHED';

  constructor() {
    super('Ce mot de passe figure dans des fuites de données connues. Choisissez-en un autre.');
  }
}

/** AUTH-02 : longueur hors bornes (le DTO la refuse déjà ; défense en profondeur). */
export class PasswordLengthError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'PASSWORD_LENGTH';

  constructor() {
    super('Le mot de passe doit compter de 12 à 256 caractères.');
  }
}

/** AUTH-09 : inscription fermée sans invitation valide. */
export class InvitationRequiredError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'INVITATION_REQUIRED';

  constructor() {
    super('L’inscription se fait sur invitation.');
  }
}

/**
 * Jeton envoyé par e-mail inconnu, expiré, déjà utilisé, ou devenu sans objet : un seul message,
 * qui ne dit pas laquelle de ces raisons s'applique.
 */
export class AccountTokenInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'TOKEN_INVALID';

  constructor() {
    super('Ce lien n’est plus valable. Demandez-en un nouveau.');
  }
}

/** Session inconnue, ou d'un autre compte (SEC-04 : pas de distinction). */
export class SessionNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'SESSION_NOT_FOUND';

  constructor() {
    super('Session introuvable.');
  }
}
