import { DomainError } from '../../../shared/domain';

/**
 * LNK-07 : jeton inconnu, expiré, épuisé, révoqué, ou d'un profil avec lequel un blocage existe
 * (dans un sens ou l'autre). Un seul refus, sans rien dire de la cause.
 */
export class InvitationInvalidError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'INVITATION_INVALID';

  constructor() {
    super('Cette invitation n’est pas valable.');
  }
}

/** LNK-07 : le lien existe déjà ; l'invitation n'est pas consommée. */
export class AlreadyLinkedError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'ALREADY_LINKED';

  constructor() {
    super('Vous êtes déjà liés.');
  }
}

/** LNK-03 : un lien relie des profils de comptes différents. */
export class LinkSameAccountError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'LINK_SAME_ACCOUNT';

  constructor() {
    super('Ces profils sont déjà dans le même cercle.');
  }
}

/** LNK-05 : on ne se bloque pas soi-même. */
export class BlockSelfError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'BLOCK_SELF';

  constructor() {
    super('Vous ne pouvez pas vous bloquer vous-même.');
  }
}

/** LNK-01 : plafond d'invitations ouvertes par profil. */
export class InvitationLimitReachedError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'INVITATION_LIMIT_REACHED';

  constructor() {
    super('Trop d’invitations sont ouvertes : révoquez-en ou attendez leur expiration.');
  }
}

/** LNK-01, PRO-05 : un profil enfant n'invite pas par e-mail. */
export class ChildEmailForbiddenError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'CHILD_EMAIL_FORBIDDEN';

  constructor() {
    super('Un profil enfant ne peut pas envoyer d’invitation par e-mail.');
  }
}

/** SEC-04 : lien, invitation ou blocage inconnu, ou hors de la portée du profil actif. */
export class LinkNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'LINK_NOT_FOUND';

  constructor() {
    super('Lien introuvable.');
  }
}
