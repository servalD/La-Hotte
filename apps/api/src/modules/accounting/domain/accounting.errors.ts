import { DomainError } from '../../../shared/domain';

// Codes stables (API-14, `13` Compta). Aucun message n'interpole de donnée d'utilisateur.

/** VIS-34, CPT-59 : élément inconnu, invisible, ou dont le profil n'a pas la compta. */
export class AccountingNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'ACCOUNTING_NOT_FOUND';
  constructor() {
    super('Accounting not found.');
  }
}

/** CPT-03 : le reste actualisé est rendu au client (`remainingMinor`). */
export class ContributionExceedsRemainingError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'CONTRIBUTION_EXCEEDS_REMAINING';
  override readonly problemMembers: Readonly<Record<string, number>>;
  constructor(remainingMinor: number) {
    super('Contribution exceeds the remaining amount.');
    this.problemMembers = { remainingMinor };
  }
}

/** CPT-60, CPT-72 : liste archivée, à la corbeille, élément retiré, événement clos. */
export class AccountingClosedError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'ACCOUNTING_CLOSED';
  constructor() {
    super('Accounting is closed for this action.');
  }
}

/** CPT-06, CPT-13 : achat coché, participations figées. */
export class ContributionFrozenError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'CONTRIBUTION_FROZEN';
  constructor() {
    super('Contributions are frozen.');
  }
}

/** CPT-65 : une participation en partie réglée ne se retire pas. */
export class ContributionSettledError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'CONTRIBUTION_SETTLED';
  constructor() {
    super('Contribution is partly settled.');
  }
}

/** Geste réservé à un autre rôle (acheteur, autre participant). */
export class AccountingActionForbiddenError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'ACCOUNTING_ACTION_FORBIDDEN';
  constructor() {
    super('Accounting action forbidden.');
  }
}

/** CPT-01, CPT-53 à CPT-56 : participation mal formée. */
export class ContributionInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'CONTRIBUTION_INVALID';
  constructor() {
    super('Contribution is invalid.');
  }
}

/** CPT-71 */
export class IdempotencyKeyRequiredError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'IDEMPOTENCY_KEY_REQUIRED';
  constructor() {
    super('Idempotency-Key header is required.');
  }
}

/** CPT-71, API-16 */
export class IdempotencyKeyReusedError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  constructor() {
    super('Idempotency key reused with another request.');
  }
}
