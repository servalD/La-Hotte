import { DomainError } from '../../../shared/domain';

/** VIS-34, SEC-04 : liste inconnue ou invisible, même refus. */
export class ListNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'LIST_NOT_FOUND';
  constructor() {
    super('Liste introuvable.');
  }
}

/** EVT-08, EVT-29 : événement inconnu, ou dont le profil n'est pas participant ; même refus. */
export class EventNotFoundForListError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'EVENT_NOT_FOUND';
  constructor() {
    super('Événement introuvable.');
  }
}

/** VIS-34 */
export class ItemNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'ITEM_NOT_FOUND';
  constructor() {
    super('Élément introuvable.');
  }
}

/** VIS-34 : action interdite sur une liste ou un élément visibles (LST-02). */
export class ListActionForbiddenError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'LIST_ACTION_FORBIDDEN';
  constructor() {
    super('Vous ne pouvez pas faire cela sur cette liste.');
  }
}

/** LST-03, critère de 03. */
export class VisibilityEditForbiddenError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'VISIBILITY_EDIT_FORBIDDEN';
  constructor() {
    super('Vous ne pouvez pas modifier qui voit cet élément.');
  }
}

/** LST-07 */
export class RecipientNotAllowedError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'RECIPIENT_NOT_ALLOWED';
  constructor() {
    super('Ce profil ne peut pas être destinataire de cette liste.');
  }
}

/** LST-08, GFT-01, GFT-06 */
export class MemberNotAllowedError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'MEMBER_NOT_ALLOWED';
  constructor() {
    super('Ce profil ne peut pas être membre de cette liste.');
  }
}

/** LST-04 */
export class SuccessorRequiredError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'SUCCESSOR_REQUIRED';
  constructor() {
    super('Désignez un responsable parmi les membres avant de quitter la liste.');
  }
}

/** LST-20, WSH-02 */
export class PersonalListLockedError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'PERSONAL_LIST_LOCKED';
  constructor() {
    super('« Mes envies » ne se supprime, ne s’archive ni ne se quitte.');
  }
}

/** GFT-04 */
export class GiftSettingsInconsistentError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'GIFT_SETTINGS_INCONSISTENT';
  constructor() {
    super('Pour montrer le contenu, l’existence de la liste doit être révélée.');
  }
}

export class ListInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'LIST_INVALID';
  constructor() {
    super('Une information de la liste n’est pas valable.');
  }
}

export class ItemInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'ITEM_INVALID';
  constructor() {
    super('Une information de l’élément n’est pas valable.');
  }
}

/** API-17 */
export class ListVersionMismatchError extends DomainError {
  readonly kind = 'precondition_failed';
  readonly code = 'VERSION_MISMATCH';
  constructor() {
    super('Cette liste ou cet élément a été modifié entre-temps.');
  }
}
