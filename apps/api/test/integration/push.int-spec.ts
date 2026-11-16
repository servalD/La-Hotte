import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import {
  NotificationRepository,
  PushSubscriptionRepository,
} from '../../src/modules/notifications/testing';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, signIn, type SignedIn } from '../support/sign-in';

// Push contre PostgreSQL réel : réclamation atomique (NOT-14, ADR 0018), appareil repris par une
// autre session, suppression avec la session (NOT-15).

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());
const KEYS = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };

async function person(): Promise<SignedIn> {
  const { accountId, profileId } = await createAccountWithProfile(prisma);
  return signIn(app, { accountId, profileId });
}

describe('Push en base', { timeout: 30_000 }, () => {
  it('ADR 0018 : deux réclamations simultanées ne prennent jamais la même notification', async () => {
    const user = await person();
    const notifications = app.get(NotificationRepository);
    for (let i = 0; i < 10; i += 1) {
      await notifications.create({
        id: randomUUID(),
        profileId: user.profileId!,
        type: 'security.login',
        category: 'SECURITY',
        subject: { kind: 'self' },
        commentId: null,
        actorId: null,
        pushDueAt: new Date(Date.now() - 1000),
        at: new Date(),
      });
    }
    const push = app.get(PushSubscriptionRepository);
    const [a, b] = await Promise.all([
      push.claimDue(new Date(), 100),
      push.claimDue(new Date(), 100),
    ]);
    const mine = [...a, ...b].filter((n) => n.profileId === user.profileId);
    expect(mine).toHaveLength(10);
    expect(new Set(mine.map((n) => n.id)).size).toBe(10);
  });

  it('NOT-15 : un appareil repris par une autre session perd ses profils ; supprimé avec elle', async () => {
    const first = await person();
    const second = await person();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
    await http()
      .post('/api/v1/push-subscriptions')
      .set(first.mutation)
      .send({ endpoint, keys: KEYS })
      .expect(204);
    await http()
      .post('/api/v1/push-subscriptions')
      .set(second.mutation)
      .send({ endpoint, keys: KEYS })
      .expect(204);
    const device = await prisma.pushSubscription.findUniqueOrThrow({
      where: { endpoint },
      include: { profiles: true },
    });
    expect(device.sessionId).toBe(second.sessionId);
    expect(device.profiles.map((p) => p.profileId)).toEqual([second.profileId]);
    await http().post('/api/v1/auth/logout').set(second.mutation).expect(204);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
  });
});
