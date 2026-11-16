import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { NotificationRepository } from '../../src/modules/notifications/testing';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, signIn, type SignedIn } from '../support/sign-in';

// Notifications contre PostgreSQL réel : `seq` par profil sous concurrence (RT-12), préférences
// (NOT-04), revérification à la lecture (NOT-11).

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

async function person(): Promise<SignedIn> {
  const { accountId, profileId } = await createAccountWithProfile(prisma);
  return signIn(app, { accountId, profileId });
}

describe('Notifications en base', { timeout: 30_000 }, () => {
  it('RT-12 : vingt notifications en parallèle reçoivent les numéros 1 à 20, sans trou ni doublon', async () => {
    const user = await person();
    const repo = app.get(NotificationRepository);
    await Promise.all(
      Array.from({ length: 20 }, () =>
        repo.create({
          id: randomUUID(),
          profileId: user.profileId!,
          type: 'security.login',
          category: 'SECURITY',
          subject: { kind: 'self' },
          commentId: null,
          actorId: null,
          pushDueAt: null,
          at: new Date(),
        }),
      ),
    );
    const seqs = (
      await prisma.notification.findMany({ where: { profileId: user.profileId! } })
    ).map((row) => Number(row.seq));
    expect(seqs.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const res = await http()
      .get('/api/v1/notifications/unread-count')
      .set({ Cookie: user.cookie })
      .expect(200);
    expect(res.body.count).toBe(20);
  });

  it('NOT-04 : préférences enregistrées ; la sécurité reste active', async () => {
    const user = await person();
    const res = await http()
      .put('/api/v1/notification-preferences')
      .set(user.mutation)
      .send({
        channels: [
          { category: 'COMMENTS', channel: 'PUSH', enabled: false },
          { category: 'SECURITY', channel: 'EMAIL', enabled: false },
        ],
        quietEnabled: true,
        quietStart: 1320,
        quietEnd: 420,
        digest: 'WEEKLY',
        sharePresence: false,
      })
      .expect(200);
    expect(res.body).toMatchObject({ quietStart: 1320, digest: 'WEEKLY', sharePresence: false });
    expect(
      await prisma.notificationPref.findMany({ where: { profileId: user.profileId! } }),
    ).toEqual([expect.objectContaining({ category: 'COMMENTS', channel: 'PUSH', enabled: false })]);
  });
});
