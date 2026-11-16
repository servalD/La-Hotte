import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import type { Thread } from '../../visibility';
import {
  type ChannelPreference,
  channelEnabled,
  type DigestFrequency,
  NOTIFICATION_PAGE_MAX,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationRecord,
  type NotificationSettings,
  type NotificationType,
  SYNC_MAX,
  UNREAD_COUNT_MAX,
} from '../domain/notification';
import {
  NotificationPeople,
  NotificationRepository,
  NotificationSubjects,
  PreferenceRepository,
} from '../domain/notification.ports';

/** Une notification telle que son profil la voit, titres relus par le moteur (NOT-11). */
export interface NotificationView {
  readonly id: string;
  readonly seq: number;
  readonly type: NotificationType;
  readonly category: NotificationCategory;
  readonly title: string | null;
  readonly context: string | null;
  readonly itemId: string | null;
  readonly thread: Thread | null;
  readonly listId: string | null;
  readonly eventId: string | null;
  readonly commentId: string | null;
  readonly actorName: string | null;
  readonly read: boolean;
  readonly createdAt: Date;
}

/** Revérifie et décrit un lot (NOT-11) ; tait ce qui n'est plus visible ou plus voulu en in-app. */
@Injectable()
export class NotificationViews {
  constructor(
    private readonly subjects: NotificationSubjects,
    private readonly preferences: PreferenceRepository,
    private readonly people: NotificationPeople,
  ) {}

  async build(profileId: string, rows: readonly NotificationRecord[]): Promise<NotificationView[]> {
    const overrides = await this.preferences.overrides(profileId);
    const names = await this.people.names(
      rows.flatMap((row) => (row.actorId ? [row.actorId] : [])),
    );
    const out: NotificationView[] = [];
    for (const row of rows) {
      if (!channelEnabled(overrides, row.category, 'IN_APP')) continue;
      const summary = await this.subjects.describe(row.subject, profileId);
      if (!summary) continue;
      const { subject } = row;
      out.push({
        id: row.id,
        seq: row.seq,
        type: row.type,
        category: row.category,
        title: summary.title,
        context: summary.context,
        itemId: subject.kind === 'item' ? subject.itemId : null,
        thread: subject.kind === 'item' ? subject.thread : null,
        listId: summary.listId,
        eventId: subject.kind === 'event' ? subject.eventId : null,
        commentId: row.commentId,
        actorName: row.actorId ? (names.get(row.actorId) ?? null) : null,
        read: row.readAt !== null,
        createdAt: row.createdAt,
      });
    }
    return out;
  }
}

/** GET /notifications (NOT-18) */
@Injectable()
export class ListNotifications {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly views: NotificationViews,
  ) {}

  async execute(input: {
    viewerId: string;
    beforeSeq?: number;
    limit?: number;
  }): Promise<{ items: NotificationView[]; nextBeforeSeq: number | null }> {
    const limit = Math.min(
      Math.max(input.limit ?? NOTIFICATION_PAGE_MAX, 1),
      NOTIFICATION_PAGE_MAX,
    );
    const rows = await this.notifications.page(input.viewerId, input.beforeSeq ?? null, limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: await this.views.build(input.viewerId, page),
      nextBeforeSeq: rows.length > limit && last ? last.seq : null,
    };
  }
}

/** GET /notifications/unread-count (VIS-22) : seules les notifications encore visibles comptent. */
@Injectable()
export class CountUnreadNotifications {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly views: NotificationViews,
  ) {}

  async execute(input: { viewerId: string }): Promise<number> {
    const rows = await this.notifications.unread(input.viewerId, UNREAD_COUNT_MAX * 2);
    const visible = await this.views.build(input.viewerId, rows);
    return Math.min(visible.length, UNREAD_COUNT_MAX);
  }
}

/** POST /notifications/read (NOT-18) */
@Injectable()
export class MarkNotificationsRead {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    viewerId: string;
    ids?: readonly string[];
    upToSeq?: number;
  }): Promise<void> {
    const target =
      input.upToSeq !== undefined ? { upToSeq: input.upToSeq } : { ids: input.ids ?? [] };
    await this.notifications.markRead(input.viewerId, target, this.clock.now());
  }
}

/** GET /sync?since= (RT-12) */
@Injectable()
export class SyncNotifications {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly views: NotificationViews,
  ) {}

  async execute(input: {
    viewerId: string;
    since: number;
  }): Promise<{ items: NotificationView[]; lastSeq: number; reset: boolean }> {
    const lastSeq = await this.notifications.lastSeq(input.viewerId);
    const first = await this.notifications.firstSeq(input.viewerId);
    const purged = first !== null && input.since + 1 < first;
    if (purged || lastSeq - input.since > SYNC_MAX || input.since > lastSeq) {
      return { items: [], lastSeq, reset: true };
    }
    const rows = await this.notifications.after(input.viewerId, input.since, SYNC_MAX);
    return { items: await this.views.build(input.viewerId, rows), lastSeq, reset: false };
  }
}

export interface PreferencesState {
  readonly channels: readonly {
    readonly category: NotificationCategory;
    readonly channel: NotificationChannel;
    readonly enabled: boolean;
    readonly locked: boolean;
  }[];
  readonly settings: NotificationSettings;
}

function stateOf(
  overrides: readonly ChannelPreference[],
  settings: NotificationSettings,
): PreferencesState {
  const categories: NotificationCategory[] = [
    'INVITATIONS',
    'LINKS',
    'COMMENTS',
    'MENTIONS',
    'GIFTS',
    'ITEMS',
    'EVENTS',
    'EXTRACTION',
    'SECURITY',
  ];
  return {
    channels: categories.flatMap((category) =>
      (['IN_APP', 'PUSH', 'EMAIL'] as const).map((channel) => ({
        category,
        channel,
        enabled: channelEnabled(overrides, category, channel),
        locked: category === 'SECURITY',
      })),
    ),
    settings,
  };
}

/** GET /notification-preferences (NOT-04, NOT-14, NOT-17, RT-11) */
@Injectable()
export class GetNotificationPreferences {
  constructor(private readonly preferences: PreferenceRepository) {}

  async execute(input: { viewerId: string }): Promise<PreferencesState> {
    return stateOf(
      await this.preferences.overrides(input.viewerId),
      await this.preferences.settings(input.viewerId),
    );
  }
}

/** PUT /notification-preferences : la sécurité reste active (NOT-04). */
@Injectable()
export class UpdateNotificationPreferences {
  constructor(private readonly preferences: PreferenceRepository) {}

  async execute(input: {
    viewerId: string;
    channels: readonly ChannelPreference[];
    quietEnabled: boolean;
    quietStart: number;
    quietEnd: number;
    digest: DigestFrequency;
    sharePresence: boolean;
  }): Promise<PreferencesState> {
    const overrides = input.channels.filter((pref) => pref.category !== 'SECURITY');
    const settings: NotificationSettings = {
      quietEnabled: input.quietEnabled,
      quietStart: input.quietStart,
      quietEnd: input.quietEnd,
      digest: input.digest,
      sharePresence: input.sharePresence,
    };
    await this.preferences.save({ profileId: input.viewerId, overrides, settings });
    return stateOf(overrides, settings);
  }
}
