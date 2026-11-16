import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signIn, type SignedIn } from '../support/sign-in';
import {
  createTestApp,
  type TestCatalog,
  type TestEvents,
  type TestIdentity,
} from './create-test-app';

// Non-régression de la revue SEC-40 de la phase 3, cycle 1 : chaque test rejoue le scénario du
// constat (B1, I1, I2, M2).

let app: INestApplication;
let identity: TestIdentity;
let catalog: TestCatalog;
let events: TestEvents;

beforeAll(async () => {
  ({ app, identity, catalog, events } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
});

const http = () => request(app.getHttpServer());
type Body = Record<string, unknown>;

async function link(x: SignedIn, y: SignedIn): Promise<void> {
  const invitation = await http().post('/api/v1/invitations').set(x.mutation).send({}).expect(201);
  await http()
    .post('/api/v1/invitations/redeem')
    .set(y.mutation)
    .send({ token: invitation.body.token as string })
    .expect(201);
}

async function person(): Promise<SignedIn> {
  const user = await identity.signIn();
  identity.accounts.seed({ id: user.accountId, email: `p-${user.accountId}@lahotte.test` });
  return user;
}

async function sibling(owner: SignedIn): Promise<SignedIn> {
  const profileId = randomUUID();
  identity.profiles.set({
    profileId,
    accountId: owner.accountId,
    hasPin: false,
    relock: 'IDLE_15',
  });
  return signIn(app, { accountId: owner.accountId, profileId });
}

async function event(org: SignedIn, body: Body): Promise<string> {
  const res = await http()
    .post('/api/v1/events')
    .set(org.mutation)
    .send({ date: '2027-12-24', ...body })
    .expect(201);
  return res.body.id as string;
}

async function invite(org: SignedIn, eventId: string, ...guests: SignedIn[]): Promise<void> {
  await http()
    .post(`/api/v1/events/${eventId}/participants`)
    .set(org.mutation)
    .send({ profileIds: guests.map((g) => g.profileId) })
    .expect(200);
}

async function rsvp(user: SignedIn, eventId: string, answer = 'YES'): Promise<Body> {
  const res = await http()
    .put(`/api/v1/events/${eventId}/rsvp`)
    .set(user.mutation)
    .send({ rsvp: answer })
    .expect(200);
  return res.body as Body;
}

async function addItem(user: SignedIn, listId: string): Promise<string> {
  const product = await http()
    .post('/api/v1/products')
    .set(user.mutation)
    .send({ title: 'Vélo' })
    .expect(201);
  const res = await http()
    .post(`/api/v1/lists/${listId}/items`)
    .set(user.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  return res.body.id as string;
}

describe('B1 : la mention de reprise n’atteint jamais un destinataire de l’origine (EVT-28)', () => {
  it('co-destinataire de la wishlist d’origine, offreur de la nouvelle liste : pas de mention', async () => {
    const org = await person();
    const a = await person();
    await link(org, a);
    const b = await sibling(a);
    await link(org, b);
    const old = await event(org, { title: 'Noël 2025', type: 'CHRISTMAS' });
    await invite(org, old, a, b);
    await rsvp(a, old, 'MAYBE');
    await rsvp(b, old, 'MAYBE');
    const shared = await http()
      .post('/api/v1/lists')
      .set(a.mutation)
      .send({
        type: 'WISHLIST',
        title: 'À deux',
        recipientIds: [a.profileId, b.profileId],
        eventId: old,
      })
      .expect(201);
    const itemId = await addItem(a, shared.body.id as string);
    const row = catalog.items.items.get(itemId)!;
    catalog.items.items.set(itemId, { ...row, status: 'PURCHASED' });
    events.events.force(old, { date: '2025-12-24' });

    const next = await event(org, { title: 'Noël 2027', type: 'CHRISTMAS' });
    await invite(org, next, a, b);
    const aList = (await rsvp(a, next)).listId as string;
    await rsvp(b, next);
    await http()
      .post(`/api/v1/events/${next}/carry-over`)
      .set(a.mutation)
      .send({ listId: aList, itemIds: [itemId] })
      .expect(201);
    const seen = await http()
      .get(`/api/v1/lists/${aList}/items`)
      .set({ Cookie: b.cookie })
      .expect(200);
    const carried = (seen.body.items as Body[])[0]!;
    expect(carried.view).toBe('giver');
    expect(carried.carriedFrom).toBeNull();
    // L'organisateur, qui n'en était pas destinataire, voit la mention.
    const fromOrg = await http()
      .get(`/api/v1/lists/${aList}/items`)
      .set({ Cookie: org.cookie })
      .expect(200);
    expect((fromOrg.body.items as Body[])[0]!.carriedFrom).toMatchObject({ status: 'PURCHASED' });
  });
});

describe('I1, I2 : listes rattachées à une surprise (EVT-29, VIS-36)', () => {
  async function surpriseWorld() {
    const org = await person();
    const honoree = await person();
    const spouse = await person();
    await link(org, honoree);
    await link(org, spouse);
    await link(honoree, spouse);
    const eventId = await event(org, {
      title: 'Les 40 ans',
      type: 'BIRTHDAY',
      isSurprise: true,
      honoreeIds: [honoree.profileId],
    });
    return { org, honoree, spouse, eventId };
  }

  it('I1 : une giftlist rattachée en audience CERCLE, SÉLECTION ou avec l’honoré membre lui reste invisible', async () => {
    const { org, honoree, spouse, eventId } = await surpriseWorld();
    const forSpouse = await http()
      .post('/api/v1/lists')
      .set(org.mutation)
      .send({
        type: 'GIFTLIST',
        title: 'Cadeau pour M',
        recipientIds: [spouse.profileId],
        eventId,
        audience: 'CIRCLE',
      })
      .expect(201);
    const id = forSpouse.body.id as string;
    await http().get(`/api/v1/lists/${id}`).set({ Cookie: honoree.cookie }).expect(404);
    await http()
      .put(`/api/v1/lists/${id}/members/${honoree.profileId as string}`)
      .set(org.mutation)
      .send({ role: 'READER' })
      .expect(204);
    await http().get(`/api/v1/lists/${id}`).set({ Cookie: honoree.cookie }).expect(404);
    const all = await http().get('/api/v1/lists').set({ Cookie: honoree.cookie }).expect(200);
    expect((all.body.items as Body[]).some((l) => l.id === id)).toBe(false);
    expect(
      (await http().get(`/api/v1/lists?eventId=${eventId}`).set({ Cookie: honoree.cookie })).body
        .items,
    ).toEqual([]);
  });

  it('I2 : le filtre ?eventId ne rend jamais l’aperçu d’une giftlist révélée', async () => {
    const { org, honoree, eventId } = await surpriseWorld();
    const gift = await http()
      .post('/api/v1/lists')
      .set(org.mutation)
      .send({
        type: 'GIFTLIST',
        title: 'Pour toi',
        recipientIds: [honoree.profileId],
        eventId,
        giftExistence: 'REVEALED',
      })
      .expect(201);
    const all = await http().get('/api/v1/lists').set({ Cookie: honoree.cookie }).expect(200);
    expect((all.body.items as Body[]).find((l) => l.id === gift.body.id)?.view).toBe('teaser');
    const filtered = await http()
      .get(`/api/v1/lists?eventId=${eventId}`)
      .set({ Cookie: honoree.cookie })
      .expect(200);
    const random = await http()
      .get(`/api/v1/lists?eventId=${randomUUID()}`)
      .set({ Cookie: honoree.cookie })
      .expect(200);
    expect(filtered.body.items).toEqual(random.body.items);
  });
});

describe('R2 : supprimer un événement clos archive ses listes (EVT-38, EVT-39)', () => {
  it('annulé puis supprimé : liste détachée, archivée, en lecture seule ; à venir : seulement détachée', async () => {
    const org = await person();
    const closed = await event(org, { title: 'Noël', type: 'CHRISTMAS' });
    const lists = await http()
      .get(`/api/v1/lists?eventId=${closed}`)
      .set({ Cookie: org.cookie })
      .expect(200);
    const listId = (lists.body.items as Body[])[0]!.id as string;
    await http().post(`/api/v1/events/${closed}/cancel`).set(org.mutation).expect(200);
    await http().delete(`/api/v1/events/${closed}`).set(org.mutation).expect(204);
    const after = await http()
      .get(`/api/v1/lists/${listId}`)
      .set({ Cookie: org.cookie })
      .expect(200);
    expect(after.body).toMatchObject({ eventId: null, archivedAt: expect.any(String) });
    const product = await http()
      .post('/api/v1/products')
      .set(org.mutation)
      .send({ title: 'Vélo' })
      .expect(201);
    await http()
      .post(`/api/v1/lists/${listId}/items`)
      .set(org.mutation)
      .send({ productId: product.body.id as string })
      .expect(403);

    const open = await event(org, { title: 'Anniv', type: 'OTHER' });
    const openLists = await http()
      .get(`/api/v1/lists?eventId=${open}`)
      .set({ Cookie: org.cookie })
      .expect(200);
    const openListId = (openLists.body.items as Body[])[0]!.id as string;
    await http().delete(`/api/v1/events/${open}`).set(org.mutation).expect(204);
    const kept = await http()
      .get(`/api/v1/lists/${openListId}`)
      .set({ Cookie: org.cookie })
      .expect(200);
    expect(kept.body).toMatchObject({ eventId: null, archivedAt: null });
  });
});

describe('M2 : retrait et rétrogradation révoquent les liens de l’auteur (EVT-06, EVT-17)', () => {
  it('liens d’un organisateur retiré, puis d’un organisateur rétrogradé', async () => {
    const org = await person();
    const a = await person();
    const b = await person();
    await link(org, a);
    await link(org, b);
    const id = await event(org, { title: 'Noël', type: 'CHRISTMAS' });
    await invite(org, id, a, b);
    for (const p of [a, b]) {
      await http()
        .put(`/api/v1/events/${id}/organizers/${p.profileId as string}`)
        .set(org.mutation)
        .expect(204);
    }
    const tokenA = (await http().post(`/api/v1/events/${id}/links`).set(a.mutation).send({})).body
      .token as string;
    const tokenB = (await http().post(`/api/v1/events/${id}/links`).set(b.mutation).send({})).body
      .token as string;
    await http()
      .delete(`/api/v1/events/${id}/participants/${a.profileId as string}`)
      .set(org.mutation)
      .expect(204);
    await http()
      .delete(`/api/v1/events/${id}/organizers/${b.profileId as string}`)
      .set(org.mutation)
      .expect(204);
    const guest = await person();
    for (const token of [tokenA, tokenB]) {
      await http()
        .post('/api/v1/events/links/redeem')
        .set(guest.mutation)
        .send({ token })
        .expect(404);
    }
  });
});
