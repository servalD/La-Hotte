import type { Thread } from '../../visibility';

// Notifications (06, NOT-01 à NOT-18 ; ADR 0018). Une notification ne garde que des identifiants
// (NOT-11) ; qui la reçoit et ce qu'elle montre sont décidés par le moteur, à la production et à
// chaque lecture.

export const NOTIFICATION_CATEGORIES = [
  'INVITATIONS',
  'LINKS',
  'COMMENTS',
  'MENTIONS',
  'GIFTS',
  'ITEMS',
  'EVENTS',
  'EXTRACTION',
  'SECURITY',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'PUSH', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const DIGEST_FREQUENCIES = ['DAILY', 'WEEKLY', 'OFF'] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

/** NOT-12 : canaux par défaut de chaque catégorie. */
export const DEFAULT_CHANNELS: Record<
  NotificationCategory,
  Record<NotificationChannel, boolean>
> = {
  INVITATIONS: { IN_APP: true, PUSH: true, EMAIL: true },
  LINKS: { IN_APP: true, PUSH: true, EMAIL: true },
  COMMENTS: { IN_APP: true, PUSH: true, EMAIL: true },
  MENTIONS: { IN_APP: true, PUSH: true, EMAIL: true },
  GIFTS: { IN_APP: true, PUSH: true, EMAIL: false },
  ITEMS: { IN_APP: true, PUSH: true, EMAIL: true },
  EVENTS: { IN_APP: true, PUSH: true, EMAIL: true },
  EXTRACTION: { IN_APP: true, PUSH: false, EMAIL: false },
  SECURITY: { IN_APP: true, PUSH: true, EMAIL: true },
};

/** Types produits en phase 4, et leur catégorie (NOT-12). */
export const NOTIFICATION_TYPES = {
  'comment.created': 'COMMENTS',
  'comment.mention': 'MENTIONS',
  'event.invited': 'INVITATIONS',
  'event.cancelled': 'EVENTS',
  'event.reminder': 'EVENTS',
  'event.day_after': 'EVENTS',
  'product.extracted': 'EXTRACTION',
  'security.pin_reset': 'SECURITY',
  'security.login': 'SECURITY',
  'security.totp_enabled': 'SECURITY',
  'security.totp_disabled': 'SECURITY',
} as const satisfies Record<string, NotificationCategory>;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/** Sujet d'une notification : ce que le moteur doit laisser voir au profil (NOT-10). */
export type NotificationSubject =
  | { readonly kind: 'item'; readonly itemId: string; readonly thread: Thread }
  | { readonly kind: 'event'; readonly eventId: string }
  | { readonly kind: 'product'; readonly productId: string }
  | { readonly kind: 'self' };

export interface NotificationRecord {
  readonly id: string;
  readonly profileId: string;
  readonly seq: number;
  readonly type: NotificationType;
  readonly category: NotificationCategory;
  readonly subject: NotificationSubject;
  readonly commentId: string | null;
  readonly actorId: string | null;
  readonly readAt: Date | null;
  readonly pushDueAt: Date | null;
  readonly pushSentAt: Date | null;
  readonly createdAt: Date;
}

/** Réglages d'un profil (NOT-04, NOT-14, NOT-17, RT-11). */
export interface NotificationSettings {
  readonly quietEnabled: boolean;
  /** Minutes depuis minuit, heure locale du profil. */
  readonly quietStart: number;
  readonly quietEnd: number;
  readonly digest: DigestFrequency;
  readonly sharePresence: boolean;
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  quietEnabled: true,
  quietStart: 21 * 60,
  quietEnd: 8 * 60,
  digest: 'DAILY',
  sharePresence: true,
};

export interface ChannelPreference {
  readonly category: NotificationCategory;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
}

/** NOT-04 : canal actif ; la sécurité ne se désactive jamais. */
export function channelEnabled(
  overrides: readonly ChannelPreference[],
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  if (category === 'SECURITY') return true;
  const override = overrides.find((p) => p.category === category && p.channel === channel);
  return override ? override.enabled : DEFAULT_CHANNELS[category][channel];
}

/** Minutes depuis minuit dans le fuseau donné. */
export function localMinutes(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/** NOT-14 : vrai si `minutes` tombe dans les heures calmes (fenêtre qui peut passer minuit). */
export function inQuietHours(settings: NotificationSettings, minutes: number): boolean {
  if (!settings.quietEnabled || settings.quietStart === settings.quietEnd) return false;
  const { quietStart: start, quietEnd: end } = settings;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * NOT-14 : échéance d'une push née à `now` : tout de suite hors des heures calmes, sinon à leur fin.
 * Un changement d'heure pendant la nuit décale l'échéance d'une heure au plus (accepté).
 */
export function pushDueAt(now: Date, settings: NotificationSettings, timezone: string): Date {
  const minutes = localMinutes(now, timezone);
  if (!inQuietHours(settings, minutes)) return now;
  const wait = (settings.quietEnd - minutes + 1440) % 1440;
  const due = new Date(now.getTime() + wait * 60_000);
  due.setUTCSeconds(0, 0);
  return due;
}

/** NOT-18 */
export const NOTIFICATION_RETENTION_DAYS = 90;
export const NOTIFICATION_PAGE_MAX = 50;
/** RT-12 */
export const SYNC_MAX = 200;
/** VIS-22 : le compteur s'arrête à 99. */
export const UNREAD_COUNT_MAX = 99;
