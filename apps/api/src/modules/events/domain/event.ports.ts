import type { EventMode, EventRole, Rsvp } from '../../visibility';
import type { EventChanges, EventRecord, EventType, PersonCard } from './event';

export interface NewEventParticipant {
  readonly id: string;
  readonly profileId: string;
  readonly role: EventRole;
  readonly isHonoree: boolean;
  readonly rsvp: Rsvp;
  readonly invitedBy: string | null;
}

export interface NewEvent {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly timezone: string;
  readonly place: string;
  readonly description: string;
  readonly type: EventType;
  readonly mode: EventMode;
  readonly isSurprise: boolean;
  readonly suggestedBudgetMinor: number | null;
  readonly currency: string;
  readonly createdBy: string;
  readonly recreatedFromId: string | null;
  readonly participants: readonly NewEventParticipant[];
  /** EVT-07 : honorés d'une surprise, jamais participants. */
  readonly surpriseRecipients: readonly { readonly id: string; readonly profileId: string }[];
  readonly now: Date;
}

export abstract class EventRepository {
  /** Une transaction ; `conflict` si un honoré de surprise est aussi participant (déclencheur). */
  abstract create(event: NewEvent): Promise<EventRecord | 'conflict'>;

  abstract find(eventId: string): Promise<EventRecord | null>;

  /** EVT-08 : événements où le profil a une ligne de participant, et seulement ceux-là. */
  abstract findForProfile(profileId: string): Promise<EventRecord[]>;

  /** API-17 */
  abstract update(input: {
    readonly eventId: string;
    readonly expectedVersion: number;
    readonly changes: EventChanges;
  }): Promise<EventRecord | 'version' | 'missing'>;

  /** EVT-34 : statut `CANCELLED`, liens révoqués, une transaction. */
  abstract cancel(eventId: string, at: Date): Promise<void>;

  /**
   * EVT-39 : une transaction ; les listes rattachées sont détachées (une audience `EVENT` devient
   * `MEMBERS`, EVT-29), les liens révoqués, puis l'événement supprimé. `archiveLists` : événement
   * clos, ses listes sont archivées en plus (EVT-39, EVT-38).
   */
  abstract delete(eventId: string, at: Date, archiveLists: boolean): Promise<void>;

  /**
   * EVT-15 : ajoute des participants `PENDING`, sans toucher à ceux qui y sont déjà.
   * `surprise_honoree` si l'un d'eux est honoré de la surprise : rien n'est écrit.
   */
  abstract addParticipants(input: {
    readonly eventId: string;
    readonly invitedBy: string;
    readonly rows: readonly { readonly id: string; readonly profileId: string }[];
  }): Promise<{ readonly added: readonly string[] } | 'surprise_honoree'>;

  /** EVT-17 : retrait et révocation des liens qu'il avait créés, une transaction (R3). */
  abstract removeParticipant(eventId: string, profileId: string, at: Date): Promise<boolean>;

  /**
   * EVT-06 : passé à `PARTICIPANT`, les liens qu'il avait créés sont révoqués dans la même
   * transaction (EVT-17, R3).
   */
  abstract setRole(eventId: string, profileId: string, role: EventRole, at: Date): Promise<boolean>;

  /** EVT-13 */
  abstract setRsvp(eventId: string, profileId: string, rsvp: Rsvp, at: Date): Promise<boolean>;

  /**
   * EVT-07 : honorés ajoutés. Hors surprise, une ligne de participant marquée (ou la marque posée
   * sur une ligne existante) ; en surprise, la table à part. `conflict` si un honoré de surprise
   * est participant ; `list_member` si, en surprise, l'un d'eux est membre d'une liste rattachée ou
   * destinataire d'une wishlist rattachée (EVT-07, R1) ; rien n'est écrit.
   */
  abstract addHonorees(input: {
    readonly eventId: string;
    readonly surprise: boolean;
    readonly invitedBy: string;
    readonly rows: readonly { readonly id: string; readonly profileId: string }[];
  }): Promise<'ok' | 'conflict' | 'list_member'>;

  /** EVT-07 : honorés d'une surprise ; lu seulement après un accès accordé (ADR 0017). */
  abstract surpriseRecipients(eventId: string): Promise<string[]>;

  /** EVT-08 : nom, avatar, couleur des profils, pour l'événement seulement. */
  abstract cards(profileIds: readonly string[]): Promise<PersonCard[]>;

  /** EVT-33 : événements à venir dont la date est antérieure à `day` (candidats, revérifiés). */
  abstract upcomingBefore(day: string): Promise<EventRecord[]>;

  abstract markDone(eventId: string): Promise<void>;

  /**
   * EVT-13, EVT-32 : événements à venir dont la date est entre `fromDay` et `toDay` (candidats
   * larges, revérifiés dans leur fuseau), avec l'état de leurs rappels.
   */
  abstract reminderCandidates(fromDay: string, toDay: string): Promise<ReminderCandidate[]>;

  /** Pose la marque d'un rappel s'il ne l'avait pas ; faux s'il l'avait (une seule instance l'envoie). */
  abstract claimReminder(eventId: string, kind: ReminderKind, at: Date): Promise<boolean>;
}

export type ReminderKind = 'reminder14' | 'reminder3' | 'dayAfter';

export interface ReminderCandidate {
  readonly event: EventRecord;
  readonly sent: Readonly<Record<ReminderKind, boolean>>;
}

export interface EventLinkRecord {
  readonly id: string;
  readonly eventId: string;
  readonly createdBy: string;
  readonly maxUses: number;
  readonly usedCount: number;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/** EVT-16 : liens d'invitation, dans la table `invitation` (type `EVENT`, ADR 0017). */
export abstract class EventLinkRepository {
  abstract create(input: {
    readonly id: string;
    readonly eventId: string;
    readonly createdBy: string;
    readonly tokenHash: string;
    readonly maxUses: number;
    readonly expiresAt: Date;
  }): Promise<EventLinkRecord>;

  abstract listOpen(eventId: string, now: Date): Promise<EventLinkRecord[]>;

  abstract revoke(eventId: string, linkId: string, now: Date): Promise<boolean>;

  /** EVT-06, EVT-17 : liens d'un auteur retiré ou qui perd le rôle d'organisateur. */
  abstract revokeCreatedBy(eventId: string, profileId: string, now: Date): Promise<void>;

  /**
   * Lien ni révoqué ni expiré, épuisé ou non : un participant déjà inscrit retrouve l'événement
   * par un lien épuisé (EVT-16) ; l'épuisement refuse les autres.
   */
  abstract findLive(tokenHash: string, now: Date): Promise<EventLinkRecord | null>;

  /**
   * EVT-16, une transaction : un participant déjà inscrit retrouve l'événement sans consommer
   * d'usage (`already`) ; sinon un usage est consommé par écriture conditionnelle et le profil
   * inscrit `PENDING` (`joined`) ; `invalid` si le lien n'est plus ouvert ou si le profil est
   * honoré de la surprise.
   */
  abstract redeem(input: {
    readonly linkId: string;
    readonly eventId: string;
    readonly profileId: string;
    readonly participantId: string;
    readonly now: Date;
  }): Promise<'joined' | 'already' | 'invalid'>;
}

/** Ce que le module doit savoir d'un profil, lu en base. */
export interface ProfileSettings {
  readonly timezone: string;
  readonly currency: string;
  readonly isChild: boolean;
}

export abstract class EventPeople {
  abstract settings(profileId: string): Promise<ProfileSettings | null>;
  /** LNK-05, EVT-16 : vrai si le profil et l'un des autres se bloquent, dans un sens ou l'autre. */
  abstract blockedWithAny(profileId: string, others: readonly string[]): Promise<boolean>;
}

/** EVT-16 : jeton de 128 bits, stocké en SHA-256. */
export abstract class EventTokens {
  abstract generate(): string;
  abstract hash(token: string): string;
  abstract isWellFormed(token: string): boolean;
}

/**
 * EVT-16, GFT-07 : un refus de lien est rendu au même temps plancher qu'un jeton inconnu, pour que
 * la durée ne révèle pas une surprise. `pad` attend le reste du plancher depuis `startedAt`.
 */
export abstract class ResponseFloor {
  abstract pad(startedAt: Date): Promise<void>;
}

/**
 * EVT-15 : e-mail neutre aux comptes des profils invités, envoyé par `identity`, et notification
 * `INVITATIONS` (NOT-12, phase 4).
 */
export abstract class EventInvitationMail {
  abstract notifyInvited(eventId: string, profileIds: readonly string[], actorId: string): void;
}

/** EVT-36 : wishlist rattachée, créée ou retrouvée par le module `lists`. */
export abstract class EventWishlistCreator {
  abstract ensure(input: { profileId: string; eventId: string }): Promise<string | null>;
}

/**
 * EVT-41 : avis de l'événement, publiés sur le bus de domaine (ADR 0018) après l'écriture ; le
 * module `notifications` les rend par candidat à travers le moteur (NOT-10).
 */
export abstract class EventNotifier {
  /** EVT-34 : tous les participants, sauf l'auteur de l'annulation. */
  abstract eventCancelled(eventId: string, profileIds: readonly string[], actorId: string): void;
  /**
   * Critère « Ne participe pas » de 05 : alerte aux organisateurs si le participant était engagé.
   * Les engagements naissent en phase 5 (VIS-16) : d'ici là, rien n'est publié.
   */
  abstract participantWithdrew(eventId: string, profileId: string): void;
  /** EVT-13, EVT-32 : rappels et invitation du lendemain (tâche planifiée). */
  abstract reminded(
    eventId: string,
    notice: 'reminder' | 'day_after',
    profileIds: readonly string[],
  ): void;
  /** RT-10 : l'événement a changé ; `accessChanged` si qui le voit a pu changer. */
  abstract changed(eventId: string, accessChanged: boolean): void;
}
