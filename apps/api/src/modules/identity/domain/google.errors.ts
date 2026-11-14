import { DomainError } from '../../../shared/domain';

/**
 * Parcours Google inconnu, expiré, déjà utilisé, ou présenté par une autre pré-session ou une
 * autre session que celle qui l'a démarré (ADR 0013). Un seul message pour toutes ces raisons.
 */
export class GoogleFlowInvalidError extends DomainError {
  readonly kind = 'unauthenticated';
  readonly code = 'GOOGLE_FLOW_INVALID';

  constructor() {
    super('Connexion avec Google expirée. Recommencez.');
  }
}

/**
 * Réponse de Google refusée : annulation par l'utilisateur, `iss`, `aud`, `nonce`, PKCE ou
 * fraîcheur (`auth_time`) invalides. La raison n'est ni renvoyée ni journalisée.
 */
export class GoogleRejectedError extends DomainError {
  readonly kind = 'unauthenticated';
  readonly code = 'GOOGLE_REJECTED';

  constructor() {
    super('Google n’a pas confirmé la connexion.');
  }
}

/** AUTH-03 : Google ne garantit pas l'adresse ; rien n'est créé ni remplacé. */
export class GoogleEmailUnverifiedError extends DomainError {
  readonly kind = 'forbidden';
  readonly code = 'GOOGLE_EMAIL_UNVERIFIED';

  constructor() {
    super('Votre adresse n’est pas vérifiée par Google.');
  }
}

/**
 * AUTH-03 : un compte vérifié a déjà cette adresse. Jamais de fusion automatique : on se connecte
 * par mot de passe, puis on associe Google depuis l'espace Compte.
 */
export class GoogleLinkRequiredError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'GOOGLE_LINK_REQUIRED';

  constructor() {
    super(
      'Un compte utilise déjà cette adresse. Connectez-vous avec votre mot de passe, puis ' +
        'associez Google depuis votre espace Compte.',
    );
  }
}

/** AUTH-16 : adresse réservée par un changement d'adresse encore annulable. */
export class GoogleEmailUnavailableError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'GOOGLE_EMAIL_UNAVAILABLE';

  constructor() {
    super('Cette adresse ne peut pas être utilisée pour le moment.');
  }
}

/** AUTH-03, AUTH-08 : aucun compte, et l'inscription n'a pas été demandée avant le départ. */
export class GoogleRegistrationRequiredError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'GOOGLE_REGISTRATION_REQUIRED';

  constructor() {
    super('Aucun compte n’est associé à ce compte Google. Inscrivez-vous d’abord.');
  }
}

/** AUTH-03 : cet identifiant Google est déjà associé à un autre compte. */
export class GoogleAlreadyLinkedElsewhereError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'GOOGLE_IDENTITY_TAKEN';

  constructor() {
    super('Ce compte Google est déjà associé à un autre compte La Hotte.');
  }
}

/** AUTH-03 : le compte a déjà une identité Google. */
export class GoogleAlreadyLinkedError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'GOOGLE_ALREADY_LINKED';

  constructor() {
    super('Un compte Google est déjà associé.');
  }
}

/** AUTH-03, AUTH-14 : aucune identité Google à dissocier ou avec laquelle se ré-authentifier. */
export class GoogleNotLinkedError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'GOOGLE_NOT_LINKED';

  constructor() {
    super('Aucun compte Google n’est associé.');
  }
}

/** AUTH-14 : le compte Google présenté n'est pas celui qui est associé. */
export class GoogleIdentityMismatchError extends DomainError {
  readonly kind = 'unauthenticated';
  readonly code = 'GOOGLE_IDENTITY_MISMATCH';

  constructor() {
    super('Ce n’est pas le compte Google associé.');
  }
}

/** AUTH-03 : dissocier Google laisserait le compte sans moyen de connexion. */
export class GooglePasswordRequiredError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'PASSWORD_REQUIRED';

  constructor() {
    super('Donnez-vous d’abord un mot de passe, sans quoi vous ne pourriez plus vous connecter.');
  }
}

/** Connexion Google non configurée sur ce serveur. */
export class GoogleUnavailableError extends DomainError {
  readonly kind = 'unavailable';
  readonly code = 'GOOGLE_UNAVAILABLE';

  constructor() {
    super('La connexion avec Google n’est pas disponible.');
  }
}
