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

/** REP-04, MOD-12 : un profil enfant ne publie pas au catalogue global. */
export class ChildPublicationForbiddenError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'CHILD_PUBLICATION_FORBIDDEN';
  constructor() {
    super('Un profil enfant ne publie pas dans le catalogue ouvert à tous.');
  }
}

/** MOD-10, MOD-12 : publication au catalogue global suspendue pour ce compte. */
export class PublicationSuspendedError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'PUBLICATION_SUSPENDED';
  constructor() {
    super('La publication dans le catalogue ouvert à tous est suspendue pour ce compte.');
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
