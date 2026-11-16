import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import {
  type ChannelPreference,
  DEFAULT_SETTINGS,
  NOTIFICATION_TYPES,
  type NotificationRecord,
  type NotificationSettings,
  type NotificationSubject,
  type NotificationType,
} from '../domain/notification';
import {
  type NewNotification,
  NotificationPeople,
  NotificationRepository,
  PreferenceRepository,
} from '../domain/notification.ports';

type Row = Prisma.NotificationGetPayload<object>;

function subjectOf(row: Row): NotificationSubject {
  if (row.itemId && row.thread) return { kind: 'item', itemId: row.itemId, thread: row.thread };
  if (row.eventId) return { kind: 'event', eventId: row.eventId };
  const data = row.data as Record<string, unknown>;
  if (typeof data.productId === 'string') return { kind: 'product', productId: data.productId };
  return { kind: 'self' };
}

function toRecord(row: Row): NotificationRecord {
  return {
    id: row.id,
    profileId: row.profileId,
    seq: Number(row.seq),
    type: row.type as NotificationType,
    category: row.category,
    subject: subjectOf(row),
    commentId: row.commentId,
    actorId: row.actorProfileId,
    readAt: row.readAt,
    pushDueAt: row.pushDueAt,
    pushSentAt: row.pushSentAt,
    createdAt: row.createdAt,
  };
}

/** Types connus seulement : une ligne d'un type retiré n'est jamais montrée. */
const KNOWN_TYPES = Object.keys(NOTIFICATION_TYPES);

@Injectable()
export class PrismaNotificationRepository extends NotificationRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(n: NewNotification): Promise<NotificationRecord> {
    const { subject } = n;
    const itemId = subject.kind === 'item' ? subject.itemId : null;
    const thread = subject.kind === 'item' ? subject.thread : null;
    const eventId = subject.kind === 'event' ? subject.eventId : null;
    const data = JSON.stringify(subject.kind === 'product' ? { productId: subject.productId } : {});
    // RT-12 : une seule instruction, donc atomique ; la ligne du compteur verrouille le profil le
    // temps de l'insertion, sans transaction interactive (qui saturerait le pool en rafale).
    await this.prisma.$executeRaw`
      WITH "counter" AS (
        INSERT INTO "notification_counter" ("profile_id", "last_seq")
        VALUES (${n.profileId}::uuid, 1)
        ON CONFLICT ("profile_id") DO UPDATE SET "last_seq" = "notification_counter"."last_seq" + 1
        RETURNING "last_seq"
      )
      INSERT INTO "notification" ("id", "profile_id", "seq", "category", "type", "item_id",
        "thread", "event_id", "comment_id", "actor_profile_id", "data", "push_due_at", "created_at")
      SELECT ${n.id}::uuid, ${n.profileId}::uuid, "counter"."last_seq",
        ${n.category}::"notification_category", ${n.type}, ${itemId}::uuid,
        ${thread}::"comment_thread", ${eventId}::uuid, ${n.commentId}::uuid,
        ${n.actorId}::uuid, ${data}::jsonb, ${n.pushDueAt}, ${n.at}
      FROM "counter"`;
    const row = await this.prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    return toRecord(row);
  }

  async page(profileId: string, beforeSeq: number | null, limit: number) {
    const rows = await this.prisma.notification.findMany({
      where: {
        profileId,
        type: { in: KNOWN_TYPES },
        ...(beforeSeq !== null ? { seq: { lt: BigInt(beforeSeq) } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async after(profileId: string, afterSeq: number, limit: number) {
    const rows = await this.prisma.notification.findMany({
      where: { profileId, type: { in: KNOWN_TYPES }, seq: { gt: BigInt(afterSeq) } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async lastSeq(profileId: string): Promise<number> {
    const row = await this.prisma.notificationCounter.findUnique({ where: { profileId } });
    return row ? Number(row.lastSeq) : 0;
  }

  async firstSeq(profileId: string): Promise<number | null> {
    const row = await this.prisma.notification.findFirst({
      where: { profileId },
      orderBy: { seq: 'asc' },
      select: { seq: true },
    });
    return row ? Number(row.seq) : null;
  }

  async unread(profileId: string, limit: number) {
    const rows = await this.prisma.notification.findMany({
      where: { profileId, readAt: null, type: { in: KNOWN_TYPES } },
      orderBy: { seq: 'desc' },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async markRead(
    profileId: string,
    target: { readonly ids: readonly string[] } | { readonly upToSeq: number },
    at: Date,
  ): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        profileId,
        readAt: null,
        ...('ids' in target
          ? { id: { in: [...target.ids] } }
          : { seq: { lte: BigInt(target.upToSeq) } }),
      },
      data: { readAt: at },
    });
  }

  async purgeBefore(before: Date): Promise<number> {
    const { count } = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: before } },
    });
    return count;
  }
}

@Injectable()
export class PrismaPreferenceRepository extends PreferenceRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async overrides(profileId: string): Promise<ChannelPreference[]> {
    return this.prisma.notificationPref.findMany({
      where: { profileId },
      select: { category: true, channel: true, enabled: true },
    });
  }

  async settings(profileId: string): Promise<NotificationSettings> {
    const row = await this.prisma.notificationSettings.findUnique({ where: { profileId } });
    return row
      ? {
          quietEnabled: row.quietEnabled,
          quietStart: row.quietStart,
          quietEnd: row.quietEnd,
          digest: row.digest,
          sharePresence: row.sharePresence,
        }
      : DEFAULT_SETTINGS;
  }

  async save(input: {
    profileId: string;
    overrides: readonly ChannelPreference[];
    settings: NotificationSettings;
  }): Promise<void> {
    const { profileId, settings } = input;
    await this.prisma.$transaction([
      this.prisma.notificationPref.deleteMany({ where: { profileId } }),
      this.prisma.notificationPref.createMany({
        data: input.overrides.map((pref) => ({ profileId, ...pref })),
        skipDuplicates: true,
      }),
      this.prisma.notificationSettings.upsert({
        where: { profileId },
        create: { profileId, ...settings },
        update: settings,
      }),
    ]);
  }
}

@Injectable()
export class PrismaNotificationPeople extends NotificationPeople {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async timezoneOf(profileId: string): Promise<string | null> {
    const row = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { timezone: true },
    });
    return row?.timezone ?? null;
  }

  async profilesOfAccount(accountId: string): Promise<string[]> {
    const rows = await this.prisma.profile.findMany({ where: { accountId }, select: { id: true } });
    return rows.map((row) => row.id);
  }

  async names(profileIds: readonly string[]): Promise<Map<string, string>> {
    if (profileIds.length === 0) return new Map();
    const rows = await this.prisma.profile.findMany({
      where: { id: { in: [...new Set(profileIds)] } },
      select: { id: true, displayName: true },
    });
    return new Map(rows.map((row) => [row.id, row.displayName]));
  }
}
