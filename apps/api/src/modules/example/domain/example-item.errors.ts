import { DomainError } from '../../../shared/domain';

/** SEC-04 : « introuvable » couvre aussi « interdit » quand l'existence est un secret. */
export class ExampleItemNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'EXAMPLE_ITEM_NOT_FOUND';

  constructor() {
    super('Cet élément est introuvable.');
  }
}

export class InvalidExampleTitleError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'EXAMPLE_TITLE_INVALID';

  constructor() {
    super('Le titre doit contenir entre 1 et 120 caractères.');
  }
}
