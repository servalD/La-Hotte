import { DomainError } from '../../../shared/domain';

/** Compte visé introuvable (ADM-06 à ADM-08, RBAC-07). */
export class AdminTargetNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'ACCOUNT_NOT_FOUND';

  constructor() {
    super('Compte introuvable.');
  }
}

/** RBAC-06 : un administrateur n'agit pas sur son propre compte, sauf pour retirer son rôle. */
export class AdminSelfActionError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'ADMIN_SELF_ACTION';

  constructor() {
    super('Cette action ne se fait pas sur son propre compte.');
  }
}

/** RBAC-07 : TOTP actif, adresse vérifiée, compte actif et autonome ; le motif n'est pas détaillé. */
export class RoleRequirementsNotMetError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'ROLE_REQUIREMENTS_NOT_MET';

  constructor() {
    super('Ce compte ne remplit pas les conditions de ce rôle.');
  }
}

/** RBAC-03, ADM-07 : le dernier administrateur actif garde son rôle. */
export class LastAdminError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'LAST_ADMIN';

  constructor() {
    super('Le dernier administrateur ne peut pas perdre son rôle ni être suspendu.');
  }
}

/** ADM-06, ADM-07 : l'état du compte ne permet pas cette action (déjà suspendu, sans TOTP…). */
export class AccountStateConflictError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'ACCOUNT_STATE_CONFLICT';

  constructor() {
    super('L’état du compte ne permet pas cette action.');
  }
}
