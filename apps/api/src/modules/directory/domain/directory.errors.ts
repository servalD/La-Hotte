import { DomainError } from '../../../shared/domain';

/** REP-06 : le serveur exige le choix explicite, même par l'API (critère de 04). */
export class HiddenItemRequiresChoiceError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'HIDDEN_ITEM_REQUIRES_CHOICE';
  constructor() {
    super(
      'Cet article est caché à certaines personnes. Le publier pourrait leur donner une idée de ce que vous préparez.',
    );
  }
}

/** REP-09 : le catalogue global ouvre avec la modération (phase 7). */
export class GlobalCatalogUnavailableError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'GLOBAL_CATALOG_UNAVAILABLE';
  constructor() {
    super('Le catalogue ouvert à tous n’est pas encore disponible.');
  }
}

/** REP-03, SEC-04 : fiche invisible ou inconnue, même refus. */
export class DirectoryEntryNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'PRODUCT_NOT_FOUND';
  constructor() {
    super('Fiche introuvable.');
  }
}
