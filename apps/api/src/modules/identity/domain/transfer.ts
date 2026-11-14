/**
 * Profils entre comptes (PRO-10 à PRO-16, LNK-11). Règles pures d'une demande de passage, de
 * détachement ou de création d'un compte sous tutelle : qui doit donner son accord, quand un accord
 * est refusé, quand la demande s'exécute ou expire, quel PIN suit le profil. Aucune entrée-sortie.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** PRO-12 : une demande, et son jeton de passage, valent 7 jours tant que les accords manquent. */
export const TRANSFER_TTL_MS = 7 * DAY;
/** PRO-12 : exécution 48 heures après le dernier accord, annulable jusque-là. */
export const TRANSFER_EXECUTION_DELAY_MS = 48 * HOUR;
/** PRO-13 : après l'exécution prévue, 24 heures pour installer le compte détaché. */
export const ACCOUNT_SETUP_TTL_MS = 24 * HOUR;
/** PRO-12 : lien d'accord ou d'annulation envoyé au profil. */
export const TRANSFER_MAIL_TOKEN_TTL_MS = 24 * HOUR;
/** PRO-10 : lien de vérification de l'adresse d'un profil. */
export const PROFILE_EMAIL_VERIFY_TTL_MS = 24 * HOUR;
/** PRO-12 : un profil marqué enfant depuis moins de 30 jours garde son propre accord. */
export const CHILD_MARK_CONSENT_WINDOW_MS = 30 * DAY;
/** PRO-12 : ni PIN réinitialisé ni adresse vérifiée depuis moins de 7 jours pour un accord. */
export const CONSENT_COOLDOWN_MS = 7 * DAY;

export type TransferKind = 'MOVE' | 'DETACH' | 'WARD';
export type TransferPinChoice = 'KEEP' | 'NEW' | 'NONE';

/** Ce que les règles d'accord lisent d'un profil. */
export interface TransferSubject {
  readonly isChild: boolean;
  readonly childChangedAt: Date | null;
  readonly hasPin: boolean;
  readonly pinResetAt: Date | null;
  readonly emailVerifiedAt: Date | null;
}

function within(at: Date | null, windowMs: number, now: Date): boolean {
  return at !== null && now.getTime() - at.getTime() < windowMs;
}

/**
 * PRO-12 (B3) : l'accord du profil est requis pour un profil non enfant, et pour un profil marqué
 * enfant depuis moins de 30 jours (on ne marque pas un adulte comme enfant pour se passer de lui).
 * Figé à la création de la demande.
 */
export function profileConsentRequired(
  subject: Pick<TransferSubject, 'isChild' | 'childChangedAt'>,
  now: Date,
): boolean {
  return !subject.isChild || within(subject.childChangedAt, CHILD_MARK_CONSENT_WINDOW_MS, now);
}

/** Par où le profil donne son accord : depuis le profil (PIN validé) ou par le lien envoyé à son adresse. */
export type ConsentChannel = 'PROFILE' | 'EMAIL';

export type ConsentRefusal = 'PIN_RECENTLY_RESET' | 'EMAIL_TOO_RECENT';

/**
 * PRO-12 (B4) : un accord est refusé pendant 7 jours après une réinitialisation ou une
 * désactivation du PIN (PIN-05), même si le PIN a été changé depuis, et par une adresse vérifiée
 * depuis moins de 7 jours. `null` si l'accord peut être donné.
 */
export function consentRefusal(
  subject: Pick<TransferSubject, 'pinResetAt' | 'emailVerifiedAt'>,
  channel: ConsentChannel,
  now: Date,
): ConsentRefusal | null {
  if (within(subject.pinResetAt, CONSENT_COOLDOWN_MS, now)) return 'PIN_RECENTLY_RESET';
  if (
    channel === 'EMAIL' &&
    (subject.emailVerifiedAt === null || within(subject.emailVerifiedAt, CONSENT_COOLDOWN_MS, now))
  ) {
    return 'EMAIL_TOO_RECENT';
  }
  return null;
}

/** PRO-12 (B1) : choix proposé par défaut : garder son PIN s'il en a un, sinon en fixer un. Jamais « aucun ». */
export function defaultPinChoice(hasPin: boolean): Extract<TransferPinChoice, 'KEEP' | 'NEW'> {
  return hasPin ? 'KEEP' : 'NEW';
}

/**
 * PRO-12 : un choix de PIN est cohérent avec le profil : « garder » suppose un PIN, « nouveau »
 * suppose que le PIN est fourni. « Aucun » est toujours possible, explicitement.
 */
export function isPinChoiceValid(
  choice: TransferPinChoice,
  hasPin: boolean,
  newPinProvided: boolean,
): boolean {
  switch (choice) {
    case 'KEEP':
      return hasPin && !newPinProvided;
    case 'NEW':
      return newPinProvided;
    case 'NONE':
      return !newPinProvided;
  }
}

/** Accords d'une demande, tels que les lit l'exécution. */
export interface TransferConsents {
  readonly profileConsentRequired: boolean;
  readonly fromAcceptedAt: Date;
  readonly toAcceptedAt: Date | null;
  readonly profileAcceptedAt: Date | null;
}

/** PRO-12 : chaque compte concerné, et le profil quand c'est requis, a donné son accord. */
export function allConsentsGiven(consents: TransferConsents): boolean {
  return (
    consents.toAcceptedAt !== null &&
    (!consents.profileConsentRequired || consents.profileAcceptedAt !== null)
  );
}

/** PRO-12 : 48 heures après le dernier accord, ou `null` tant qu'il en manque un. */
export function executionTime(consents: TransferConsents): Date | null {
  if (!allConsentsGiven(consents)) return null;
  const last = Math.max(
    consents.fromAcceptedAt.getTime(),
    consents.toAcceptedAt?.getTime() ?? 0,
    consents.profileAcceptedAt?.getTime() ?? 0,
  );
  return new Date(last + TRANSFER_EXECUTION_DELAY_MS);
}

/**
 * PRO-12 (I3 du cycle 2) : tous les accords donnés, l'expiration ne joue plus et l'échéance est
 * l'exécution ; sans eux, la demande expire à son terme.
 */
export function isTransferExpired(
  transfer: { readonly executesAt: Date | null; readonly expiresAt: Date },
  now: Date,
): boolean {
  return transfer.executesAt === null && transfer.expiresAt.getTime() <= now.getTime();
}

/** Compte d'origine, tel que le lisent les contrôles d'un départ. */
export interface DepartureContext {
  /** Le compte est sous tutelle (PRO-15). */
  readonly isWard: boolean;
  /** Profils qui resteraient dans le compte après le départ. */
  readonly remaining: readonly { readonly isChild: boolean }[];
}

export type DepartureRefusal = 'GUARDIAN_REQUIRED' | 'UNDECLARED_REGROUP' | 'LAST_PROFILE';

/**
 * PRO-12, PRO-13 : un départ ne laisse pas un compte (hors tutelle) avec des enfants seuls ; un
 * regroupement (dernier profil) doit avoir été déclaré, et seul un passage peut en être un. Le
 * compte tuteur sans tuteur pour un enfant sous tutelle se vérifie en base, par les liens de tutelle.
 */
export function departureRefusal(
  kind: TransferKind,
  context: DepartureContext,
  declaredRegroup: boolean,
): DepartureRefusal | null {
  if (context.remaining.length === 0) {
    if (kind !== 'MOVE') return 'LAST_PROFILE';
    return declaredRegroup ? null : 'UNDECLARED_REGROUP';
  }
  if (!context.isWard && context.remaining.every((profile) => profile.isChild)) {
    return 'GUARDIAN_REQUIRED';
  }
  return null;
}
