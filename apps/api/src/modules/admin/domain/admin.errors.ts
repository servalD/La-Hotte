import { DomainError } from '../../../shared/domain';

/** API-14 : curseur de pagination illisible. */
export class AuditCursorInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'AUDIT_CURSOR_INVALID';

  constructor() {
    super('Curseur de pagination invalide.');
  }
}
