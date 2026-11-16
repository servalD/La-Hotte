import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signIn, type SignedIn } from '../support/sign-in';
import { createTestApp, type TestCatalog, type TestIdentity } from './create-test-app';

// Avancement et « qui n'a encore rien » (EVT-30, EVT-31, EVT-37) ; critère de 05 : jamais sur une
// liste dont le lecteur est destinataire, même co-destinataire.

let app: INestApplication;
let identity: TestIdentity;
let catalog: TestCatalog;

beforeAll(async () => {
  ({ app, identity, catalog } = await createTestApp());
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

async function yes(user: SignedIn, eventId: string): Promise<string | null> {
  const res = await http()
    .put(`/api/v1/events/${eventId}/rsvp`)
    .set(user.mutation)
    .send({ rsvp: 'YES' })
    .expect(200);
  return res.body.listId as string | null;
}

async function addItem(user: SignedIn, listId: string): Promise<string> {
  const product = await http()
    .post('/api/v1/products')
    .set(user.mutation)
    .send({ title: 'Idée' })
    .expect(201);
  const res = await http()
    .post(`/api/v1/lists/${listId}/items`)
    .set(user.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  return res.body.id as string;
}

async function progress(user: SignedIn, eventId: string): Promise<Body> {
  const res = await http()
    .get(`/api/v1/events/${eventId}/progress`)
    .set({ Cookie: user.cookie })
    .expect(200);
  return res.body as Body;
}

describe('EVT-30, EVT-31, EVT-37', () => {
  it('compte les listes des autres vues en offreur ; l’ensemble de départ ne dépend d’aucun état', async () => {
    const org = await person();
    const a = await person();
    const b = await person();
    await link(org, a);
    await link(org, b);
    const created = await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Noël', date: '2027-12-24', type: 'CHRISTMAS' })
      .expect(201);
    const eventId = created.body.id as string;
    await http()
      .post(`/api/v1/events/${eventId}/participants`)
      .set(org.mutation)
      .send({ profileIds: [a.profileId, b.profileId] })
      .expect(200);
    const aList = (await yes(a, eventId))!;
    const bList = (await yes(b, eventId))!;
    const aItem = await addItem(a, aList);
    await addItem(a, aList);
    await addItem(b, bList);

    const before = await progress(b, eventId);
    // B ne compte pas sa propre liste : 2 souhaits d'A ; la liste de l'organisateur est vide.
    expect(before).toMatchObject({ itemsTotal: 2, itemsWithGiver: 0 });
    expect(before.recipients).toEqual([a.profileId, org.profileId].sort());
    expect(before.recipientsWithoutGiver).toEqual(before.recipients);

    catalog.engagements.engaged.set(aItem, [org.profileId as string]);
    const after = await progress(b, eventId);
    expect(after).toMatchObject({ itemsTotal: 2, itemsWithGiver: 1 });
    expect(after.recipients).toEqual(before.recipients);
    expect(after.recipientsWithoutGiver).toEqual([org.profileId]);
    // A, destinataire de sa liste, n'y lit jamais rien.
    const forA = await progress(a, eventId);
    expect(forA).toMatchObject({ itemsTotal: 1, itemsWithGiver: 0 });
    expect(forA.recipients).not.toContain(a.profileId);
  });

  it('critère de 05 : une wishlist partagée n’entre pas dans l’avancement de ses co-destinataires', async () => {
    const org = await person();
    const b = await person();
    await link(org, b);
    const partner = await sibling(b);
    await link(org, partner);
    const created = await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Noël', date: '2027-12-24', type: 'CHRISTMAS' })
      .expect(201);
    const eventId = created.body.id as string;
    await http()
      .post(`/api/v1/events/${eventId}/participants`)
      .set(org.mutation)
      .send({ profileIds: [b.profileId, partner.profileId] })
      .expect(200);
    await yes(partner, eventId);
    await http()
      .put(`/api/v1/events/${eventId}/rsvp`)
      .set(b.mutation)
      .send({ rsvp: 'MAYBE' })
      .expect(200);
    const shared = await http()
      .post('/api/v1/lists')
      .set(b.mutation)
      .send({
        type: 'WISHLIST',
        title: 'Pour nous deux',
        recipientIds: [b.profileId, partner.profileId],
        eventId,
      })
      .expect(201);
    const item = await addItem(b, shared.body.id as string);
    catalog.engagements.engaged.set(item, [org.profileId as string]);
    const forPartner = await progress(partner, eventId);
    expect(forPartner.recipients).not.toContain(b.profileId);
    expect(forPartner.recipients).not.toContain(partner.profileId);
    expect(forPartner).toMatchObject({ itemsWithGiver: 0 });
    // L'organisateur, offreur, la voit.
    expect(await progress(org, eventId)).toMatchObject({ itemsWithGiver: 1 });
  });

  it('un profil qui ne participe pas reçoit 404', async () => {
    const org = await person();
    const created = await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Noël', date: '2027-12-24', type: 'CHRISTMAS' })
      .expect(201);
    await http()
      .get(`/api/v1/events/${created.body.id as string}/progress`)
      .set({ Cookie: (await person()).cookie })
      .expect(404);
  });
});
