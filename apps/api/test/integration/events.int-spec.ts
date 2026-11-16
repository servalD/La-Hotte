import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, signIn, type SignedIn } from '../support/sign-in';

// Événements contre PostgreSQL réel : déclencheurs de l'ADR 0017 vus par l'API, lien d'invitation
// (EVT-16), suppression qui détache les listes (EVT-39), temps plancher d'un refus (GFT-07).

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

describe('Événements en base (ADR 0017)', { timeout: 30_000 }, () => {
  it('EVT-07 : surprise créée ; l’honoré refusé à l’invitation directe et au lien, au temps plancher', async () => {
    const org = await person();
    const honoree = await person();
    await link(org, honoree);
    const created = await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({
        title: 'Les 40 ans',
        date: '2027-06-01',
        type: 'BIRTHDAY',
        isSurprise: true,
        honoreeIds: [honoree.profileId],
      })
      .expect(201);
    const id = created.body.id as string;
    await http()
      .post(`/api/v1/events/${id}/participants`)
      .set(org.mutation)
      .send({ profileIds: [honoree.profileId] })
      .expect(422)
      .expect((res) => {
        expect(res.body.code).toBe('EVENT_HONOREE_CANNOT_PARTICIPATE');
      });
    const token = (await http().post(`/api/v1/events/${id}/links`).set(org.mutation).send({})).body
      .token as string;
    const started = Date.now();
    await http()
      .post('/api/v1/events/links/redeem')
      .set(honoree.mutation)
      .send({ token })
      .expect(404);
    expect(Date.now() - started).toBeGreaterThanOrEqual(480);
    const startedUnknown = Date.now();
    await http()
      .post('/api/v1/events/links/redeem')
      .set(honoree.mutation)
      .send({ token: 'AAAAAAAAAAAAAAAAAAAAAA' })
      .expect(404);
    expect(Date.now() - startedUnknown).toBeGreaterThanOrEqual(480);
    await http().get(`/api/v1/events/${id}`).set({ Cookie: honoree.cookie }).expect(404);
    expect(
      await prisma.eventParticipant.count({
        where: { eventId: id, profileId: honoree.profileId! },
      }),
    ).toBe(0);
  });

  it('EVT-16 : inscription par lien, un usage consommé, idempotente', async () => {
    const org = await person();
    const guest = await person();
    const created = await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Noël', date: '2027-12-24', type: 'CHRISTMAS' })
      .expect(201);
    const id = created.body.id as string;
    const token = (
      await http().post(`/api/v1/events/${id}/links`).set(org.mutation).send({ maxUses: 1 })
    ).body.token as string;
    await http()
      .post('/api/v1/events/links/redeem')
      .set(guest.mutation)
      .send({ token })
      .expect(200);
    await http()
      .post('/api/v1/events/links/redeem')
      .set(guest.mutation)
      .send({ token })
      .expect(200);
    const invitation = await prisma.invitation.findFirstOrThrow({
      where: { kind: 'EVENT', targetId: id },
    });
    expect(invitation.usedCount).toBe(1);
    const res = await http().get(`/api/v1/events/${id}`).set({ Cookie: guest.cookie }).expect(200);
    expect(res.body.myRsvp).toBe('PENDING');
  });

  it('EVT-14, EVT-36 : wishlist créée à la réponse, vue des participants Participe seulement', async () => {
    const org = await person();
    const guest = await person();
    await link(org, guest);
    const created = await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Noël', date: '2027-12-24', type: 'CHRISTMAS' })
      .expect(201);
    const id = created.body.id as string;
    await http()
      .post(`/api/v1/events/${id}/participants`)
      .set(org.mutation)
      .send({ profileIds: [guest.profileId] })
      .expect(200);
    const answer = await http()
      .put(`/api/v1/events/${id}/rsvp`)
      .set(guest.mutation)
      .send({ rsvp: 'YES' })
      .expect(200);
    const guestListId = answer.body.listId as string;
    const fromOrg = await http()
      .get(`/api/v1/lists?eventId=${id}`)
      .set({ Cookie: org.cookie })
      .expect(200);
    expect((fromOrg.body.items as { id: string }[]).map((l) => l.id)).toContain(guestListId);
    await http()
      .put(`/api/v1/events/${id}/rsvp`)
      .set(org.mutation)
      .send({ rsvp: 'NO' })
      .expect(200);
    await http().get(`/api/v1/lists/${guestListId}`).set({ Cookie: org.cookie }).expect(404);
  });

  it('EVT-22, EVT-27 : candidats à la reprise en base, reprise unique', async () => {
    const lea = await person();
    const first = await http()
      .post('/api/v1/events')
      .set(lea.mutation)
      .send({ title: 'Noël 2025', date: '2027-12-24', type: 'CHRISTMAS' })
      .expect(201);
    const oldId = first.body.id as string;
    const oldLists = await http()
      .get(`/api/v1/lists?eventId=${oldId}`)
      .set({ Cookie: lea.cookie })
      .expect(200);
    const oldList = (oldLists.body.items as { id: string }[])[0]!;
    const product = await http()
      .post('/api/v1/products')
      .set(lea.mutation)
      .send({ title: 'Vélo' })
      .expect(201);
    const item = await http()
      .post(`/api/v1/lists/${oldList.id}/items`)
      .set(lea.mutation)
      .send({ productId: product.body.id as string })
      .expect(201);
    await prisma.listItem.update({
      where: { id: item.body.id as string },
      data: { status: 'PURCHASED' },
    });
    await prisma.event.update({ where: { id: oldId }, data: { date: new Date('2025-12-24') } });
    const next = await http()
      .post('/api/v1/events')
      .set(lea.mutation)
      .send({ title: 'Noël 2027', date: '2027-12-24', type: 'CHRISTMAS' })
      .expect(201);
    const nextId = next.body.id as string;
    const candidates = await http()
      .get(`/api/v1/events/${nextId}/carry-over`)
      .set({ Cookie: lea.cookie })
      .expect(200);
    expect(candidates.body.items).toHaveLength(1);
    const nextLists = await http()
      .get(`/api/v1/lists?eventId=${nextId}`)
      .set({ Cookie: lea.cookie })
      .expect(200);
    const target = (nextLists.body.items as { id: string }[])[0]!;
    const body = { listId: target.id, itemIds: [item.body.id as string] };
    await http()
      .post(`/api/v1/events/${nextId}/carry-over`)
      .set(lea.mutation)
      .send(body)
      .expect(201);
    await http()
      .post(`/api/v1/events/${nextId}/carry-over`)
      .set(lea.mutation)
      .send(body)
      .expect(422);
    expect(
      await prisma.listItem.count({ where: { carriedFromItemId: item.body.id as string } }),
    ).toBe(1);
  });

  it('EVT-39 : la suppression détache les listes, une audience EVENT devient MEMBERS', async () => {
    const org = await person();
    const created = await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Noël', date: '2027-12-24', type: 'CHRISTMAS' })
      .expect(201);
    const id = created.body.id as string;
    const listId = randomUUID();
    await prisma.list.create({
      data: {
        id: listId,
        type: 'WISHLIST',
        title: 'Noël',
        creatorProfileId: org.profileId!,
        eventId: id,
        audience: 'EVENT',
      },
    });
    await http().delete(`/api/v1/events/${id}`).set(org.mutation).expect(204);
    const list = await prisma.list.findUniqueOrThrow({ where: { id: listId } });
    expect(list).toMatchObject({ eventId: null, audience: 'MEMBERS' });
  });
});
