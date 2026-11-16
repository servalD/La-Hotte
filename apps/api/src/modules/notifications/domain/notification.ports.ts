import type { PushDevice, PushPayload } from './push';
import type {
  ChannelPreference,
  DigestFrequency,
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

/** NOT-15, NOT-16 : appareils abonnés. */
export abstract class PushSubscriptionRepository {
  /**
   * Abonne l'appareil (un point de terminaison) pour ce profil et cette session ; un appareil
   * repris par une autre session perd ses profils précédents. `limit` si le profil a déjà 10
   * appareils.
   */
  abstract register(input: {
    readonly id: string;
    readonly sessionId: string;
    readonly profileId: string;
    readonly endpoint: string;
    readonly p256dh: string;
    readonly auth: string;
    readonly showDetails: boolean;
  }): Promise<'ok' | 'limit'>;
  /** Retire le profil de l'appareil de cette session ; l'appareil disparaît sans profil. */
  abstract unregister(input: {
    readonly sessionId: string;
    readonly profileId: string;
    readonly endpoint: string;
  }): Promise<void>;
  /** Faux si l'appareil n'est pas à cette session ou n'a pas ce profil. */
  abstract setDetails(input: {
    readonly sessionId: string;
    readonly profileId: string;
    readonly endpoint: string;
    readonly showDetails: boolean;
  }): Promise<boolean>;
  abstract devicesOf(profileId: string): Promise<PushDevice[]>;
  abstract remove(subscriptionId: string): Promise<void>;
  /**
   * NOT-14 : réclame jusqu'à `limit` notifications non lues dont la push est due, en posant
   * `push_sent_at` (une seule instance les envoie).
   */
  abstract claimDue(now: Date, limit: number): Promise<NotificationRecord[]>;
}

export abstract class PushSender {
  /** VAPID configuré ? */
  abstract enabled(): boolean;
  abstract publicKey(): string | null;
  /** `gone` : l'appareil s'est désabonné (404, 410), l'abonnement est à supprimer. */
  abstract send(device: PushDevice, payload: PushPayload): Promise<'ok' | 'gone' | 'error'>;
}

/** Ce que les sorties hors application doivent savoir des sessions et des comptes (`identity`). */
export abstract class DeliveryGateway {
  /** NOT-15 : la session de l'appareil vit encore. */
  abstract sessionAlive(sessionId: string): Promise<boolean>;
  /** NOT-17 : un message au compte. */
  abstract sendDigest(
    accountId: string,
    entries: readonly { readonly profileName: string; readonly count: number }[],
  ): Promise<boolean>;
}

/** NOT-17 : profils dont un résumé peut être dû, et le moment de leur dernier résumé. */
export interface DigestCandidate {
  readonly profileId: string;
  readonly accountId: string;
  readonly profileName: string;
  readonly digest: DigestFrequency;
  readonly lastDigestAt: Date | null;
}

export abstract class DigestRepository {
  /** Profils qui ont une notification non lue née depuis `since`. */
  abstract candidates(since: Date): Promise<DigestCandidate[]>;
  /** Non lues nées depuis `since`, les plus récentes d'abord. */
  abstract unreadSince(
    profileId: string,
    since: Date,
    limit: number,
  ): Promise<NotificationRecord[]>;
  /**
   * NOT-17 : pose `last_digest_at = at` seulement s'il vaut encore `expected` ; faux si une autre
   * instance l'a déjà fait (un seul résumé par période).
   */
  abstract claimDigest(profileId: string, expected: Date | null, at: Date): Promise<boolean>;
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
