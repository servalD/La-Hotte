import { DomainError } from '../../../shared/domain';

/**
 * PRO-12, SEC-04 : jeton de passage inconnu, expiré, consommé ou annulé, ou compte qui ne porte
 * aucun profil du cercle du profil qui part, ou qui porte un profil bloqué : un seul refus.
 */
export class TransferInvalidError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'TRANSFER_INVALID';

  constructor() {
    super('Cette demande n’est pas valable.');
  }
}

/** PRO-12 : un seul passage ouvert par profil. */
export class TransferPendingError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'TRANSFER_PENDING';

  constructor() {
    super('Une demande est déjà ouverte pour ce profil.');
  }
}

/**
 * PRO-12 (B4, B4 bis) : accord du profil refusé pendant 7 jours après une réinitialisation ou une
 * désactivation de son PIN, ou par une adresse vérifiée depuis moins de 7 jours.
 */
export class TransferConsentUnsafeError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'TRANSFER_CONSENT_UNSAFE';

  constructor() {
    super('Cet accord ne peut pas être donné maintenant. Réessayez dans quelques jours.');
  }
}

/** PRO-12, PRO-15 : un compte tuteur ne disparaît pas par un regroupement. */
export class HasWardsError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'HAS_WARDS';

  constructor() {
    super('Ce compte a des comptes sous sa tutelle.');
  }
}

/** PRO-12 : le dernier profil d'un compte ne part que par un regroupement déclaré. */
export class UndeclaredRegroupError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'LAST_PROFILE';

  constructor() {
    super('C’est le dernier profil du compte : déclarez le regroupement, qui supprime le compte.');
  }
}

/** PRO-12 : choix de PIN incohérent (garder sans PIN, nouveau sans PIN fourni). */
export class TransferPinChoiceError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'TRANSFER_PIN_CHOICE_INVALID';

  constructor() {
    super('Le choix du code PIN ne convient pas à ce profil.');
  }
}

/** PRO-13 : un profil enfant ne se détache pas (retrait du marqueur ou tutelle d'abord). */
export class DetachChildForbiddenError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'DETACH_CHILD_FORBIDDEN';

  constructor() {
    super('Un profil enfant ne peut pas recevoir son propre compte ainsi.');
  }
}

/** PRO-13, AUTH-08 : un compte détaché déclare son âge à l'installation. */
export class AgeAttestationRequiredError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'AGE_ATTESTATION_REQUIRED';

  constructor() {
    super('Déclarez avoir 15 ans ou plus pour activer ce compte.');
  }
}

/** PRO-13 : le profil n'a pas d'adresse vérifiée et aucune n'est saisie pour le nouveau compte. */
export class DetachEmailRequiredError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'DETACH_EMAIL_REQUIRED';

  constructor() {
    super('Indiquez l’adresse du nouveau compte.');
  }
}
