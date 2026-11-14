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

/** PRO-11 : seul un profil non enfant invite à créer un profil. */
export class ProfileInvitationForbiddenError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'PROFILE_INVITATION_FORBIDDEN';

  constructor() {
    super('Un profil enfant ne peut pas inviter à créer un profil.');
  }
}

/**
 * PRO-11, SEC-04 : profil visé hors du cercle de l'invitant (ou de son compte, ou bloqué, ou d'un
 * compte sous tutelle) : un seul refus, qui ne dit pas pourquoi.
 */
export class InvitationTargetInvalidError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'INVITATION_TARGET_INVALID';

  constructor() {
    super('Ce compte ne peut pas être visé.');
  }
}

/** PRO-11 : le compte visé n'a pas encore accepté la proposition ; le jeton n'est pas consommé. */
export class ProfileProposalPendingError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'PROFILE_PROPOSAL_PENDING';

  constructor() {
    super('Le compte qui recevra ce profil ne l’a pas encore accepté.');
  }
}
