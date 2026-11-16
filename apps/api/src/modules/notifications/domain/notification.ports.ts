import type {
  ChannelPreference,
  NotificationCategory,
  NotificationRecord,
  NotificationSettings,
  NotificationSubject,
  NotificationType,
} from './notification';

export interface NewNotification {
  readonly id: string;
  readonly profileId: string;
  readonly type: NotificationType;
  readonly category: NotificationCategory;
  readonly subject: NotificationSubject;
  readonly commentId: string | null;
  readonly actorId: string | null;
  readonly pushDueAt: Date | null;
  readonly at: Date;
}

export abstract class NotificationRepository {
  /** RT-12 : `seq` tiré du compteur du profil, dans la transaction de l'insertion. */
  abstract create(notification: NewNotification): Promise<NotificationRecord>;
  /** NOT-18 : du plus récent au plus ancien, avant `beforeSeq` s'il est donné. */
  abstract page(
    profileId: string,
    beforeSeq: number | null,
    limit: number,
  ): Promise<NotificationRecord[]>;
  /** RT-12 : plus récentes que `afterSeq`, dans l'ordre croissant. */
  abstract after(profileId: string, afterSeq: number, limit: number): Promise<NotificationRecord[]>;
  abstract lastSeq(profileId: string): Promise<number>;
  /** Plus ancien numéro encore conservé (purge de NOT-18), ou `null`. */
  abstract firstSeq(profileId: string): Promise<number | null>;
  /** VIS-22 : non lues, les plus récentes d'abord. */
  abstract unread(profileId: string, limit: number): Promise<NotificationRecord[]>;
  /** NOT-18 : par identifiants, ou toutes jusqu'à `upToSeq`. */
  abstract markRead(
    profileId: string,
    target: { readonly ids: readonly string[] } | { readonly upToSeq: number },
    at: Date,
  ): Promise<void>;
  /** NOT-18 */
  abstract purgeBefore(before: Date): Promise<number>;
}

export abstract class PreferenceRepository {
  abstract overrides(profileId: string): Promise<ChannelPreference[]>;
  abstract settings(profileId: string): Promise<NotificationSettings>;
  /** NOT-04 : remplace les écarts au défaut. */
  abstract save(input: {
    readonly profileId: string;
    readonly overrides: readonly ChannelPreference[];
    readonly settings: NotificationSettings;
  }): Promise<void>;
}

/** Ce que le module doit savoir des profils (fuseau, profils d'un compte). */
export abstract class NotificationPeople {
  abstract timezoneOf(profileId: string): Promise<string | null>;
  abstract profilesOfAccount(accountId: string): Promise<string[]>;
  /** Nom de l'auteur d'un geste, montré seulement avec un sujet que le lecteur voit. */
  abstract names(profileIds: readonly string[]): Promise<Map<string, string>>;
}

/** Titres d'un sujet relus à l'affichage (NOT-11). */
export interface SubjectSummary {
  readonly title: string | null;
  readonly context: string | null;
  /** Liste de l'élément, pour y conduire. */
  readonly listId: string | null;
}

/**
 * NOT-10, NOT-11 : seul juge de « ce profil lit-il ce sujet sous la forme requise ? », par le
 * moteur (ADR 0018).
 */
export abstract class NotificationSubjects {
  /** Profils, parmi ceux donnés, qui lisent le sujet. */
  abstract readers(
    subject: NotificationSubject,
    profileIds: readonly string[],
  ): Promise<Set<string>>;
  /** `null` si le profil ne lit plus le sujet. */
  abstract describe(
    subject: NotificationSubject,
    profileId: string,
  ): Promise<SubjectSummary | null>;
}
