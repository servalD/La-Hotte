import { DomainError } from '../../../shared/domain';

/** NOT-16 */
export class PushEndpointInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'PUSH_ENDPOINT_INVALID';
  constructor() {
    super('Cet abonnement aux notifications n’est pas accepté.');
  }
}

/** NOT-15 : 10 appareils par profil. */
export class PushSubscriptionLimitError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'PUSH_SUBSCRIPTION_LIMIT';
  constructor() {
    super('Ce profil reçoit déjà les notifications sur 10 appareils.');
  }
}
