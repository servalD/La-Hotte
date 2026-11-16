import { DomainError } from '../../../shared/domain';

/**
 * COM-11, VIS-34 : un fil qu'un profil ne lit pas répond comme un élément invisible (même code),
 * pour qu'un destinataire n'apprenne rien du fil Offreurs.
 */
export class ThreadNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'ITEM_NOT_FOUND';
  constructor() {
    super('Élément introuvable.');
  }
}

/** COM-11 : message inconnu, ou d'un fil que le profil ne lit pas. */
export class CommentNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'COMMENT_NOT_FOUND';
  constructor() {
    super('Message introuvable.');
  }
}

/** COM-11, COM-15, COM-16 : action interdite sur un message ou un fil que le profil lit. */
export class CommentActionForbiddenError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'COMMENT_ACTION_FORBIDDEN';
  constructor() {
    super('Vous ne pouvez pas faire cela sur ce message.');
  }
}

/** COM-15 */
export class CommentEditExpiredError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'COMMENT_EDIT_EXPIRED';
  constructor() {
    super('Ce message ne peut plus être modifié.');
  }
}

/** COM-13 */
export class CommentInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'COMMENT_INVALID';
  constructor() {
    super('Le message doit contenir entre 1 et 2 000 caractères.');
  }
}
