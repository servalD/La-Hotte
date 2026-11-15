import { DomainError } from '../../../shared/domain';

/** VIS-16 : un profil engagé sur l'élément ne peut pas en être écarté. */
export class VisibilityEngagedProfileError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'VISIBILITY_ENGAGED_PROFILE';
  constructor() {
    super('Une personne engagée sur cet élément ne le verrait plus. Prévenez-la d’abord.');
  }
}

/** VIS-19 */
export class VisibilityProfileInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'VISIBILITY_PROFILE_INVALID';
  constructor() {
    super('Ce profil ne peut pas figurer dans cette règle.');
  }
}
