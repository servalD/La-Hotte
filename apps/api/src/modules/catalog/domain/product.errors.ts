import { DomainError } from '../../../shared/domain';

/** ART-05, SEC-04 : fiche inconnue, ou d'un autre profil. */
export class ProductNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'PRODUCT_NOT_FOUND';

  constructor() {
    super('Fiche introuvable.');
  }
}

export class ProductInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'PRODUCT_INVALID';

  constructor() {
    super('Une information de la fiche n’est pas valable.');
  }
}

/** API-17 */
export class ProductVersionMismatchError extends DomainError {
  readonly kind = 'precondition_failed';
  readonly code = 'VERSION_MISMATCH';

  constructor() {
    super('Cette fiche a été modifiée entre-temps.');
  }
}

/** EXT-47 */
export class ImageNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'IMAGE_NOT_FOUND';

  constructor() {
    super('Image introuvable.');
  }
}
