import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { AppConfig } from '../../../platform/config/env';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { CheckSessionAlive, DigestMailer } from '../../identity';
import type { NotificationRecord } from '../domain/notification';
import {
  DeliveryGateway,
  type DigestCandidate,
  DigestRepository,
  PushSender,
  PushSubscriptionRepository,
} from '../domain/notification.ports';
import { PUSH_DEVICES_PER_PROFILE, type PushDevice, type PushPayload } from '../domain/push';
import { notificationRecord } from './prisma-notifications';

@Injectable()
export class PrismaPushSubscriptionRepository extends PushSubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async register(input: {
    id: string;
    sessionId: string;
    profileId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    showDetails: boolean;
  }): Promise<'ok' | 'limit'> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.pushSubscription.findUnique({
        where: { endpoint: input.endpoint },
      });
      const others = await tx.pushSubscriptionProfile.count({
        where: {
          profileId: input.profileId,
          ...(existing ? { subscriptionId: { not: existing.id } } : {}),
        },
      });
      if (others >= PUSH_DEVICES_PER_PROFILE) return 'limit' as const;
      let subscriptionId = existing?.id ?? input.id;
      if (!existing) {
        await tx.pushSubscription.create({
          data: {
            id: input.id,
            sessionId: input.sessionId,
            endpoint: input.endpoint,
            p256dh: input.p256dh,
            auth: input.auth,
          },
        });
      } else {
        // Repris par une autre session (nouvelle connexion) : ses anciens profils ne le suivent pas.
        if (existing.sessionId !== input.sessionId) {
          await tx.pushSubscriptionProfile.deleteMany({ where: { subscriptionId: existing.id } });
        }
        await tx.pushSubscription.update({
          where: { id: existing.id },
          data: { sessionId: input.sessionId, p256dh: input.p256dh, auth: input.auth },
        });
        subscriptionId = existing.id;
      }
      await tx.pushSubscriptionProfile.upsert({
        where: { subscriptionId_profileId: { subscriptionId, profileId: input.profileId } },
        create: { subscriptionId, profileId: input.profileId, showDetails: input.showDetails },
        update: { showDetails: input.showDetails },
      });
      return 'ok' as const;
    });
  }

  async unregister(input: { sessionId: string; profileId: string; endpoint: string }) {
    const existing = await this.prisma.pushSubscription.findUnique({
      where: { endpoint: input.endpoint },
    });
    if (!existing || existing.sessionId !== input.sessionId) return;
    await this.prisma.$transaction([
      this.prisma.pushSubscriptionProfile.deleteMany({
        where: { subscriptionId: existing.id, profileId: input.profileId },
      }),
      this.prisma.pushSubscription.deleteMany({
        where: { id: existing.id, profiles: { none: {} } },
      }),
    ]);
  }

  async setDetails(input: {
    sessionId: string;
    profileId: string;
    endpoint: string;
    showDetails: boolean;
  }): Promise<boolean> {
    const { count } = await this.prisma.pushSubscriptionProfile.updateMany({
      where: {
        profileId: input.profileId,
        subscription: { endpoint: input.endpoint, sessionId: input.sessionId },
      },
      data: { showDetails: input.showDetails },
    });
    return count === 1;
  }

  async devicesOf(profileId: string): Promise<PushDevice[]> {
    const rows = await this.prisma.pushSubscriptionProfile.findMany({
      where: { profileId },
      include: { subscription: true },
    });
    return rows.map((row) => ({
      subscriptionId: row.subscriptionId,
      sessionId: row.subscription.sessionId,
      endpoint: row.subscription.endpoint,
      p256dh: row.subscription.p256dh,
      auth: row.subscription.auth,
      showDetails: row.showDetails,
    }));
  }

  async remove(subscriptionId: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { id: subscriptionId } });
  }

  async claimDue(now: Date, limit: number): Promise<NotificationRecord[]> {
    // Une instruction : la réclamation est atomique, plusieurs instances n'envoient qu'une fois.
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "notification" SET "push_sent_at" = ${now}
      WHERE "id" IN (
        SELECT "id" FROM "notification"
        WHERE "push_due_at" <= ${now} AND "push_sent_at" IS NULL AND "read_at" IS NULL
        ORDER BY "push_due_at" LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"`;
    if (claimed.length === 0) return [];
    const rows = await this.prisma.notification.findMany({
      where: { id: { in: claimed.map((row) => row.id) } },
    });
    return rows.map(notificationRecord);
  }
}

@Injectable()
export class PrismaDigestRepository extends DigestRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async candidates(since: Date): Promise<DigestCandidate[]> {
    const rows = await this.prisma.profile.findMany({
      where: { notifications: { some: { readAt: null, createdAt: { gte: since } } } },
      select: {
        id: true,
        accountId: true,
        displayName: true,
        notifSettings: { select: { digest: true, lastDigestAt: true } },
      },
      take: 1000,
    });
    return rows.map((row) => ({
      profileId: row.id,
      accountId: row.accountId,
      profileName: row.displayName,
      digest: row.notifSettings?.digest ?? 'DAILY',
      lastDigestAt: row.notifSettings?.lastDigestAt ?? null,
    }));
  }

  async unreadSince(profileId: string, since: Date, limit: number) {
    const rows = await this.prisma.notification.findMany({
      where: { profileId, readAt: null, createdAt: { gte: since } },
      orderBy: { seq: 'desc' },
      take: limit,
    });
    return rows.map(notificationRecord);
  }

  async markDigested(profileId: string, at: Date): Promise<void> {
    await this.prisma.notificationSettings.upsert({
      where: { profileId },
      create: { profileId, lastDigestAt: at },
      update: { lastDigestAt: at },
    });
  }
}

/** NOT-15 : `web-push` (VAPID) ; désactivé sans clés. Ni point de terminaison ni clé journalisés. */
@Injectable()
export class WebPushSender extends PushSender {
  private readonly logger = new Logger(WebPushSender.name);
  private readonly vapid: { publicKey: string; privateKey: string; subject: string } | null;

  constructor(config: AppConfig) {
    super();
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = config.env;
    this.vapid =
      VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT
        ? { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT }
        : null;
  }

  enabled(): boolean {
    return this.vapid !== null;
  }

  publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  async send(device: PushDevice, payload: PushPayload): Promise<'ok' | 'gone' | 'error'> {
    if (!this.vapid) return 'error';
    try {
      await webpush.sendNotification(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(payload),
        { vapidDetails: this.vapid, TTL: 24 * 3600, timeout: 5000 },
      );
      return 'ok';
    } catch (error) {
      const status = (error as { statusCode?: unknown }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      // OBS-20 : le code seul ; jamais l'erreur, qui porte le point de terminaison.
      this.logger.warn({ status: typeof status === 'number' ? status : null }, 'Push refusée');
      return 'error';
    }
  }
}

@Injectable()
export class IdentityDeliveryGateway extends DeliveryGateway {
  constructor(
    private readonly sessions: CheckSessionAlive,
    private readonly digests: DigestMailer,
  ) {
    super();
  }

  sessionAlive(sessionId: string): Promise<boolean> {
    return this.sessions.execute(sessionId);
  }

  sendDigest(
    accountId: string,
    entries: readonly { profileName: string; count: number }[],
  ): Promise<boolean> {
    return this.digests.send(accountId, entries);
  }
}
