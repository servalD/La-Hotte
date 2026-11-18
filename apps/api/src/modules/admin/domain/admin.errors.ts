import { DomainError } from '../../../shared/domain';

/** API-14 : curseur de pagination illisible. */
export class AuditCursorInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'AUDIT_CURSOR_INVALID';

  constructor() {
    super('Curseur de pagination invalide.');
  }
}

/** ADM-10 : plafond de recherches atteint. */
export class AccountSearchRateLimitedError extends DomainError {
  readonly kind = 'rate_limited';
  readonly code = 'ACCOUNT_SEARCH_RATE_LIMITED';
  override readonly retryAfterSeconds = 3600;

  constructor() {
    super('Trop de recherches de compte : réessayez plus tard.');
  }
}
