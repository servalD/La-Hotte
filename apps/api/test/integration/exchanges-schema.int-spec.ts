import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, signIn, type SignedIn } from '../support/sign-in';

// Contraintes des échanges en base (DAT-01, COM-13 à COM-16, NOT-04, NOT-14, NOT-16, ADR 0018).

let app: INestApplication;
let prisma: PrismaService;
let user: SignedIn;
let itemId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  const { accountId, profileId } = await createAccountWithProfile(prisma);
  user = await signIn(app, { accountId, profileId });
  const http = () => request(app.getHttpServer());
  const product = await http()
    .post('/api/v1/products')
    .set(user.mutation)
    .send({ title: 'Vélo' })
    .expect(201);
  const list = await http()
    .post('/api/v1/lists')
    .set(user.mutation)
    .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [profileId] })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${list.body.id as string}/items`)
    .set(user.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  itemId = item.body.id as string;
});

afterAll(async () => {
  await app.close();
});

function comment(data: Partial<Prisma.CommentUncheckedCreateInput>) {
  return prisma.comment.create({
    data: {
      id: randomUUID(),
      itemId,
      thread: 'PUBLIC',
      kind: 'MESSAGE',
      authorProfileId: user.profileId,
      body: 'Quelle taille ?',
      ...data,
    },
  });
}

describe('Échanges en base (DAT-01)', () => {
  it('COM-13 : un message vivant a un texte, 10 mentions au plus', async () => {
    await expect(comment({})).resolves.toBeDefined();
    await expect(comment({ body: '   ' })).rejects.toThrow();
    await expect(
      comment({ mentionIds: Array.from({ length: 11 }, () => randomUUID()) }),
    ).rejects.toThrow();
  });

  it('COM-14 : une activité n’a ni texte, ni mention, ni modification', async () => {
    await expect(
      comment({ kind: 'ACTIVITY', body: '', activityCode: 'PRICE_CHANGED', activityData: {} }),
    ).resolves.toBeDefined();
    await expect(
      comment({ kind: 'ACTIVITY', body: 'texte', activityCode: 'PRICE_CHANGED' }),
    ).rejects.toThrow();
    await expect(comment({ kind: 'ACTIVITY', body: '' })).rejects.toThrow();
    await expect(comment({ activityCode: 'PRICE_CHANGED' })).rejects.toThrow();
    await expect(
      comment({ kind: 'ACTIVITY', body: '', activityCode: 'price; drop' }),
    ).rejects.toThrow();
  });

  it('COM-15 : un message supprimé n’a plus ni texte ni mention', async () => {
    const created = await comment({ mentionIds: [user.profileId!] });
    await expect(
      prisma.comment.update({ where: { id: created.id }, data: { deletedAt: new Date() } }),
    ).rejects.toThrow();
    await expect(
      prisma.comment.update({
        where: { id: created.id },
        data: { deletedAt: new Date(), body: '', mentionIds: [] },
      }),
    ).resolves.toBeDefined();
  });

  it('COM-16 : une réaction par profil et par sorte', async () => {
    const created = await comment({});
    const reaction = {
      commentId: created.id,
      profileId: user.profileId!,
      reaction: 'HEART' as const,
    };
    await prisma.commentReaction.create({ data: reaction });
    await expect(prisma.commentReaction.create({ data: reaction })).rejects.toThrow();
  });

  it('NOT-04 : la sécurité ne se désactive pas ; RT-12 : seq unique par profil', async () => {
    await expect(
      prisma.notificationPref.create({
        data: { profileId: user.profileId!, category: 'SECURITY', channel: 'PUSH', enabled: false },
      }),
    ).rejects.toThrow();
    const row = {
      profileId: user.profileId!,
      seq: 1n,
      category: 'COMMENTS' as const,
      type: 'comment.created',
    };
    await prisma.notification.create({ data: { id: randomUUID(), ...row } });
    await expect(
      prisma.notification.create({ data: { id: randomUUID(), ...row } }),
    ).rejects.toThrow();
    await expect(
      prisma.notification.create({
        data: { id: randomUUID(), ...row, seq: 2n, thread: 'GIVERS' },
      }),
    ).rejects.toThrow();
  });

  it('NOT-14 : heures calmes en minutes ; NOT-16 : point de terminaison https', async () => {
    await expect(
      prisma.notificationSettings.create({
        data: { profileId: user.profileId!, quietStart: 1440 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.pushSubscription.create({
        data: {
          id: randomUUID(),
          sessionId: user.sessionId,
          endpoint: 'http://fcm.googleapis.com/x',
          p256dh: 'k',
          auth: 'a',
        },
      }),
    ).rejects.toThrow();
  });
});
