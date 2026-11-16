import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { InProcessAppEvents } from '../../src/platform/events/in-process-app-events';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, signIn, type SignedIn } from '../support/sign-in';

// Fils contre PostgreSQL réel : pages, suppression, réactions, suivi, activité (COM-13 à COM-17,
// NOT-13).

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
type Body = Record<string, unknown>;

async function person(): Promise<SignedIn> {
  const { accountId, profileId } = await createAccountWithProfile(prisma);
  return signIn(app, { accountId, profileId });
}

async function link(x: SignedIn, y: SignedIn): Promise<void> {
  const [a, b] = [x.profileId!, y.profileId!].sort();
  await prisma.profileLink.create({
    data: {
      id: randomUUID(),
      profileAId: a!,
      profileBId: b!,
      status: 'ACCEPTED',
      requestedBy: a!,
      aGuardianRequired: false,
      bGuardianRequired: false,
    },
  });
}

describe('Fils en base', { timeout: 30_000 }, () => {
  it('pages, modification, suppression, réactions, suivi et activité', async () => {
    const lea = await person();
    const paul = await person();
    await link(lea, paul);
    const list = await http()
      .post('/api/v1/lists')
      .set(lea.mutation)
      .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [lea.profileId] })
      .expect(201);
    const product = await http()
      .post('/api/v1/products')
      .set(lea.mutation)
      .send({ title: 'Vélo', unitPriceMinor: 4900, currency: 'EUR' })
      .expect(201);
    const item = await http()
      .post(`/api/v1/lists/${list.body.id as string}/items`)
      .set(lea.mutation)
      .send({ productId: product.body.id as string })
      .expect(201);
    const itemId = item.body.id as string;

    const ids: string[] = [];
    for (const body of ['un', 'deux', 'trois']) {
      const res = await http()
        .post(`/api/v1/items/${itemId}/comments`)
        .set(paul.mutation)
        .send({ thread: 'GIVERS', body, mentionIds: [lea.profileId] })
        .expect(201);
      // COM-13 : la destinataire ne lit pas le fil Offreurs, sa mention est ignorée.
      expect(res.body.mentions).toEqual([]);
      ids.push(res.body.id as string);
    }
    const first = await http()
      .get(`/api/v1/items/${itemId}/comments?thread=GIVERS&limit=2`)
      .set({ Cookie: paul.cookie })
      .expect(200);
    expect((first.body.items as Body[]).map((c) => c.body)).toEqual(['trois', 'deux']);
    const rest = await http()
      .get(
        `/api/v1/items/${itemId}/comments?thread=GIVERS&cursor=${first.body.nextCursor as string}`,
      )
      .set({ Cookie: paul.cookie })
      .expect(200);
    expect((rest.body.items as Body[]).map((c) => c.body)).toEqual(['un']);

    await http().put(`/api/v1/comments/${ids[0]!}/reactions/PARTY`).set(paul.mutation).expect(204);
    await http().delete(`/api/v1/comments/${ids[0]!}`).set(paul.mutation).expect(204);
    const deleted = await prisma.comment.findUniqueOrThrow({ where: { id: ids[0]! } });
    expect(deleted).toMatchObject({ body: '', mentionIds: [] });
    expect(await prisma.commentReaction.count({ where: { commentId: ids[0]! } })).toBe(0);

    const threads = await http()
      .get(`/api/v1/items/${itemId}/threads`)
      .set({ Cookie: paul.cookie })
      .expect(200);
    expect(threads.body).toMatchObject({ givers: { count: 2 }, following: true });

    // COM-14 : prix changé par la destinataire ; NOT-13 : elle suit l'élément ajouté.
    await http()
      .patch(`/api/v1/items/${itemId}`)
      .set({ ...lea.mutation, 'If-Match': String(item.body.version) })
      .send({ unitPriceMinor: 3900 })
      .expect(200);
    await app.get(InProcessAppEvents).drain();
    const activity = await prisma.comment.findFirstOrThrow({
      where: { itemId, kind: 'ACTIVITY' },
    });
    expect(activity).toMatchObject({
      thread: 'PUBLIC',
      activityCode: 'PRICE_CHANGED',
      activityData: { before: 4900, after: 3900, currency: 'EUR' },
    });
    expect(
      await prisma.itemFollow.findUnique({
        where: { itemId_profileId: { itemId, profileId: lea.profileId! } },
      }),
    ).toMatchObject({ following: true });
  });
});
