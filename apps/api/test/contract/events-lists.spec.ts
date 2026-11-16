import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import { createTestApp, type TestIdentity } from './create-test-app';

// Listes d'un événement (EVT-14, EVT-24, EVT-29, EVT-36, EVT-38, GFT-11, VIS-03, VIS-19) et
// critères de 05 : trois gestes jusqu'à la liste ; `Ne participe pas` coupe l'accès à la requête
// suivante ; l'honoré d'une surprise ne voit rien.

let app: INestApplication;
let identity: TestIdentity;

beforeAll(async () => {
  ({ app, identity } = await createTestApp());
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

async function exchange(org: SignedIn, ...guests: SignedIn[]): Promise<string> {
  const res = await http()
    .post('/api/v1/events')
    .set(org.mutation)
    .send({ title: 'Noël', date: '2027-12-24', type: 'CHRISTMAS' })
    .expect(201);
  const id = res.body.id as string;
  if (guests.length) {
    await http()
      .post(`/api/v1/events/${id}/participants`)
      .set(org.mutation)
      .send({ profileIds: guests.map((g) => g.profileId) })
      .expect(200);
  }
  return id;
}

async function rsvp(user: SignedIn, eventId: string, answer: string): Promise<Body> {
  const res = await http()
    .put(`/api/v1/events/${eventId}/rsvp`)
    .set(user.mutation)
    .send({ rsvp: answer })
    .expect(200);
  return res.body as Body;
}

async function lists(user: SignedIn, query = ''): Promise<Body[]> {
  const res = await http().get(`/api/v1/lists${query}`).set({ Cookie: user.cookie }).expect(200);
  return res.body.items as Body[];
}

async function product(user: SignedIn): Promise<string> {
  const res = await http()
    .post('/api/v1/products')
    .set(user.mutation)
    .send({ title: 'Vélo', unitPriceMinor: 19999 })
    .expect(201);
  return res.body.id as string;
}

describe('EVT-36 : liste créée à la réponse Participe (trois gestes au plus)', () => {
  it('répondre Participe rend une wishlist rattachée, audience ÉVÉNEMENT, retrouvée ensuite', async () => {
    const org = await person();
    const guest = await person();
    await link(org, guest);
    const eventId = await exchange(org, guest);
    const first = await rsvp(guest, eventId, 'YES');
    expect(first.listId).toEqual(expect.any(String));
    const again = await rsvp(guest, eventId, 'YES');
    expect(again.listId).toBe(first.listId);
    const list = await http()
      .get(`/api/v1/lists/${first.listId as string}`)
      .set({ Cookie: guest.cookie })
      .expect(200);
    expect(list.body).toMatchObject({
      view: 'recipient',
      title: 'Noël',
      eventId,
      audience: 'EVENT',
      recipients: [guest.profileId],
    });
    expect((await rsvp(guest, eventId, 'MAYBE')).listId).toBeNull();
    // Le créateur d'un échange a la sienne dès la création.
    expect(await lists(org, `?eventId=${eventId}`)).toContainEqual(
      expect.objectContaining({ view: 'recipient', eventId }),
    );
  });

  it('« à l’honneur » : seul l’honoré apporte une liste', async () => {
    const org = await person();
    const honoree = await person();
    const giver = await person();
    await link(org, honoree);
    await link(org, giver);
    const res = await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({
        title: 'Anniv',
        date: '2027-06-01',
        type: 'BIRTHDAY',
        honoreeIds: [honoree.profileId],
      })
      .expect(201);
    const eventId = res.body.id as string;
    await http()
      .post(`/api/v1/events/${eventId}/participants`)
      .set(org.mutation)
      .send({ profileIds: [giver.profileId] })
      .expect(200);
    expect((await rsvp(giver, eventId, 'YES')).listId).toBeNull();
    expect((await rsvp(honoree, eventId, 'YES')).listId).toEqual(expect.any(String));
  });
});

describe('VIS-03, EVT-14 : audience ÉVÉNEMENT', () => {
  it('Participe et Peut-être voient ; En attente, Ne participe pas et le cercle non ; Ne participe pas coupe à la requête suivante', async () => {
    const org = await person();
    const yes = await person();
    const pending = await person();
    const circleOnly = await person();
    await link(org, yes);
    await link(org, pending);
    await link(org, circleOnly);
    const eventId = await exchange(org, yes, pending);
    const orgList = (await lists(org, `?eventId=${eventId}`))[0]!;
    const listId = orgList.id as string;
    await rsvp(yes, eventId, 'YES');
    expect(await lists(yes, `?eventId=${eventId}`)).toContainEqual(
      expect.objectContaining({ id: listId, view: 'giver' }),
    );
    await http().get(`/api/v1/lists/${listId}`).set({ Cookie: yes.cookie }).expect(200);
    await http().get(`/api/v1/lists/${listId}`).set({ Cookie: pending.cookie }).expect(404);
    await http().get(`/api/v1/lists/${listId}`).set({ Cookie: circleOnly.cookie }).expect(404);
    await rsvp(yes, eventId, 'NO');
    await http().get(`/api/v1/lists/${listId}`).set({ Cookie: yes.cookie }).expect(404);
    await rsvp(yes, eventId, 'MAYBE');
    await http().get(`/api/v1/lists/${listId}/items`).set({ Cookie: yes.cookie }).expect(200);
  });

  it('EVT-04, GFT-07 : giftlist de la surprise vue des offreurs, jamais de l’honoré', async () => {
    const org = await person();
    const honoree = await person();
    const giver = await person();
    await link(org, honoree);
    await link(org, giver);
    const res = await http()
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
    const eventId = res.body.id as string;
    await http()
      .post(`/api/v1/events/${eventId}/participants`)
      .set(org.mutation)
      .send({ profileIds: [giver.profileId] })
      .expect(200);
    await rsvp(giver, eventId, 'YES');
    const gift = await http()
      .post('/api/v1/lists')
      .set(org.mutation)
      .send({
        type: 'GIFTLIST',
        title: 'Cadeau commun',
        recipientIds: [honoree.profileId],
        eventId,
        audience: 'EVENT',
      })
      .expect(201);
    const giftId = gift.body.id as string;
    expect(gift.body).toMatchObject({ view: 'giver', eventId, audience: 'EVENT' });
    await http().get(`/api/v1/lists/${giftId}`).set({ Cookie: giver.cookie }).expect(200);
    await http().get(`/api/v1/lists/${giftId}`).set({ Cookie: honoree.cookie }).expect(404);
    const seen = await lists(honoree);
    expect(seen.some((l) => l.id === giftId)).toBe(false);
    expect(await lists(honoree, `?eventId=${eventId}`)).toEqual([]);
    // Révélée sans contenu : l'aperçu ne porte jamais l'événement (GFT-09).
    await http()
      .patch(`/api/v1/lists/${giftId}`)
      .set({ ...org.mutation, 'If-Match': String(gift.body.version) })
      .send({ giftExistence: 'REVEALED' })
      .expect(200);
    const teaser = (await lists(honoree)).find((l) => l.id === giftId)!;
    expect(teaser).toEqual({ view: 'teaser', id: giftId, content: 'NONE' });
  });
});

describe('EVT-24, EVT-29 : rattacher, détacher', () => {
  it('rattacher n’élargit pas l’audience ; ÉVÉNEMENT ensuite permise ; détacher la passe à MEMBRES', async () => {
    const org = await person();
    const guest = await person();
    await link(org, guest);
    const eventId = await exchange(org, guest);
    await rsvp(guest, eventId, 'MAYBE');
    const created = await http()
      .post('/api/v1/lists')
      .set(guest.mutation)
      .send({ type: 'WISHLIST', title: 'Ma liste' })
      .expect(201);
    const id = created.body.id as string;
    await http()
      .patch(`/api/v1/lists/${id}`)
      .set({ ...guest.mutation, 'If-Match': String(created.body.version) })
      .send({ audience: 'EVENT' })
      .expect(422);
    const attached = await http()
      .put(`/api/v1/lists/${id}/event`)
      .set(guest.mutation)
      .send({ eventId })
      .expect(200);
    expect(attached.body).toMatchObject({ eventId, audience: 'CIRCLE' });
    const widened = await http()
      .patch(`/api/v1/lists/${id}`)
      .set({ ...guest.mutation, 'If-Match': String(attached.body.version) })
      .send({ audience: 'EVENT' })
      .expect(200);
    expect(widened.body.audience).toBe('EVENT');
    await http().put(`/api/v1/lists/${id}/event`).set(guest.mutation).send({ eventId }).expect(403);
    const detached = await http()
      .delete(`/api/v1/lists/${id}/event`)
      .set(guest.mutation)
      .expect(200);
    expect(detached.body).toMatchObject({ eventId: null, audience: 'MEMBERS' });
  });

  it('refus : pas participant (404 comme un inconnu), réponse En attente, liste personnelle', async () => {
    const org = await person();
    const guest = await person();
    const outsider = await person();
    await link(org, guest);
    const eventId = await exchange(org, guest);
    const own = await http()
      .post('/api/v1/lists')
      .set(outsider.mutation)
      .send({ type: 'WISHLIST', title: 'x' })
      .expect(201);
    const asOutsider = await http()
      .put(`/api/v1/lists/${own.body.id as string}/event`)
      .set(outsider.mutation)
      .send({ eventId })
      .expect(404);
    expect(asOutsider.body.code).toBe('EVENT_NOT_FOUND');
    const mine = await http()
      .post('/api/v1/lists')
      .set(guest.mutation)
      .send({ type: 'WISHLIST', title: 'x' })
      .expect(201);
    await http()
      .put(`/api/v1/lists/${mine.body.id as string}/event`)
      .set(guest.mutation)
      .send({ eventId })
      .expect(403);
    await rsvp(guest, eventId, 'YES');
    const personal = (await lists(guest)).find((l) => l.personal === true)!;
    await http()
      .put(`/api/v1/lists/${personal.id as string}/event`)
      .set(guest.mutation)
      .send({ eventId })
      .expect(403);
  });

  it('LST-07 étendu : une giftlist rattachée vise un honoré hors de son cercle', async () => {
    const org = await person();
    const honoree = await person();
    const giver = await person();
    await link(org, honoree);
    await link(org, giver);
    const res = await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({
        title: 'Anniv',
        date: '2027-06-01',
        type: 'BIRTHDAY',
        honoreeIds: [honoree.profileId],
      })
      .expect(201);
    const eventId = res.body.id as string;
    await http()
      .post(`/api/v1/events/${eventId}/participants`)
      .set(org.mutation)
      .send({ profileIds: [giver.profileId] })
      .expect(200);
    await rsvp(giver, eventId, 'YES');
    const body = { type: 'GIFTLIST', title: 'Pour toi', recipientIds: [honoree.profileId] };
    await http().post('/api/v1/lists').set(giver.mutation).send(body).expect(422);
    await http()
      .post('/api/v1/lists')
      .set(giver.mutation)
      .send({ ...body, eventId })
      .expect(201);
  });

  it('VIS-19 : une règle peut nommer un participant hors du cercle', async () => {
    const org = await person();
    const guest = await person();
    const token = await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Noël', date: '2027-12-24', type: 'CHRISTMAS' })
      .expect(201);
    const eventId = token.body.id as string;
    const linkRes = await http()
      .post(`/api/v1/events/${eventId}/links`)
      .set(org.mutation)
      .send({})
      .expect(201);
    await http()
      .post('/api/v1/events/links/redeem')
      .set(guest.mutation)
      .send({ token: linkRes.body.token as string })
      .expect(200);
    await rsvp(guest, eventId, 'YES');
    const orgList = (await lists(org, `?eventId=${eventId}`))[0]!;
    const item = await http()
      .post(`/api/v1/lists/${orgList.id as string}/items`)
      .set(org.mutation)
      .send({ productId: await product(org) })
      .expect(201);
    await http()
      .put(`/api/v1/items/${item.body.id as string}/visibility`)
      .set({ ...org.mutation, 'If-Match': String(item.body.version) })
      .send({ mode: 'EXCEPT', profileIds: [guest.profileId] })
      .expect(200);
  });
});

describe('EVT-38, GFT-11 : clôture et reçu', () => {
  it('événement annulé : liste en lecture seule, le reçu reste permis', async () => {
    const org = await person();
    const eventId = await exchange(org);
    const list = (await lists(org, `?eventId=${eventId}`))[0]!;
    const listId = list.id as string;
    const item = await http()
      .post(`/api/v1/lists/${listId}/items`)
      .set(org.mutation)
      .send({ productId: await product(org) })
      .expect(201);
    await http().post(`/api/v1/events/${eventId}/cancel`).set(org.mutation).expect(200);
    await http()
      .post(`/api/v1/lists/${listId}/items`)
      .set(org.mutation)
      .send({ productId: await product(org) })
      .expect(403);
    const received = await http()
      .post(`/api/v1/items/${item.body.id as string}/received`)
      .set(org.mutation)
      .expect(200);
    expect(received.body).toMatchObject({ view: 'recipient', received: true });
  });

  it('GFT-11 : le créateur d’une giftlist constate la remise ; un lecteur non', async () => {
    const org = await person();
    const friend = await person();
    const reader = await person();
    await link(org, friend);
    await link(org, reader);
    const gift = await http()
      .post('/api/v1/lists')
      .set(org.mutation)
      .send({ type: 'GIFTLIST', title: 'Pour Paul', recipientIds: [friend.profileId] })
      .expect(201);
    const giftId = gift.body.id as string;
    await http()
      .put(`/api/v1/lists/${giftId}/members/${reader.profileId as string}`)
      .set(org.mutation)
      .send({ role: 'READER' })
      .expect(204);
    const item = await http()
      .post(`/api/v1/lists/${giftId}/items`)
      .set(org.mutation)
      .send({ productId: await product(org) })
      .expect(201);
    const itemId = item.body.id as string;
    await http().post(`/api/v1/items/${itemId}/received`).set(reader.mutation).expect(403);
    const done = await http()
      .post(`/api/v1/items/${itemId}/received`)
      .set(org.mutation)
      .expect(200);
    expect(done.body).toMatchObject({ view: 'giver', status: 'RECEIVED' });
  });
});
