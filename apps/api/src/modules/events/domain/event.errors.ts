import { DomainError } from '../../../shared/domain';

/** EVT-08, VIS-34, SEC-04 : événement inconnu ou invisible (honoré d'une surprise compris), même refus. */
export class EventNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'EVENT_NOT_FOUND';
  constructor() {
    super('Événement introuvable.');
  }
}

/** VIS-34 : action interdite sur un événement visible. */
export class EventActionForbiddenError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'EVENT_ACTION_FORBIDDEN';
  constructor() {
    super('Vous ne pouvez pas faire cela sur cet événement.');
  }
}

export class EventInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'EVENT_INVALID';
  constructor() {
    super('Une information de l’événement n’est pas valable.');
  }
}

/** EVT-05 */
export class EventDatePassedError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'EVENT_DATE_PASSED';
  constructor() {
    super('La date de l’événement est déjà passée.');
  }
}

/** EVT-07, EVT-15 */
export class EventHonoreeCannotParticipateError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'EVENT_HONOREE_CANNOT_PARTICIPATE';
  constructor() {
    super('Ce profil est à l’honneur de la surprise : il ne peut pas y participer.');
  }
}

/** EVT-07, EVT-15 : hors du cercle, ou déjà participant quand il ne doit pas l'être. */
export class EventProfileNotAllowedError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'EVENT_PROFILE_NOT_ALLOWED';
  constructor() {
    super('Ce profil ne peut pas être ajouté à cet événement.');
  }
}

/** EVT-16 : jeton inconnu, révoqué, épuisé, expiré, ou ouvert par qui ne peut pas rejoindre. */
export class EventInvitationInvalidError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'EVENT_INVITATION_INVALID';
  constructor() {
    super('Ce lien d’invitation n’est pas valable.');
  }
}

/** EVT-16 */
export class EventChildOutsideCircleError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'EVENT_CHILD_OUTSIDE_CIRCLE';
  constructor() {
    super('Un profil enfant ne rejoint un événement que par un proche de son cercle.');
  }
}

/** API-17 */
export class EventVersionMismatchError extends DomainError {
  readonly kind = 'precondition_failed';
  readonly code = 'VERSION_MISMATCH';
  constructor() {
    super('Cet événement a été modifié entre-temps.');
  }
}
