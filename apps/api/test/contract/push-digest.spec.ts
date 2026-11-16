import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import { createTestApp, type TestConversations, type TestIdentity } from './create-test-app';

// Web Push et résumé e-mail (NOT-06, NOT-07, NOT-08, NOT-14 à NOT-17).

let app: INestApplication;
let identity: TestIdentity;
let conversations: TestConversations;

beforeAll(async () => {
  ({ app, identity, conversations } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
  conversations.pushSender.sent.length = 0;
  conversations.delivery.digests.length = 0;
});

const http = () => request(app.getHttpServer());
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const KEYS = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };

async function link(x: SignedIn, y: SignedIn): Promise<void> {
  const invitation = await http().post('/api/v1/invitations').set(x.mutation).send({}).expect(201);
  await http()
    .post('/api/v1/invitations/redeem')
    .set(y.mutation)
    .send({ token: invitation.body.token as string })
    .expect(201);
}

async function person(name: string): Promise<SignedIn> {
  const user = await identity.signIn({ displayName: name });
  identity.accounts.seed({ id: user.accountId, email: `p-${user.accountId}@lahotte.test` });
  // NOT-14 : sans heures calmes, la push part tout de suite, quelle que soit l'heure du test.
  await http()
    .put('/api/v1/notification-preferences')
    .set(user.mutation)
    .send({
      channels: [],
      quietEnabled: false,
      quietStart: 0,
      quietEnd: 0,
      digest: 'DAILY',
      sharePresence: true,
    })
    .expect(200);
  return user;
}

async function world() {
  const lea = await person('Léa');
  const paul = await person('Paul');
  const marc = await person('Marc');
  await link(lea, paul);
  await link(lea, marc);
  const list = await http()
    .post('/api/v1/lists')
    .set(lea.mutation)
    .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [lea.profileId] })
    .expect(201);
  const product = await http()
    .post('/api/v1/products')
    .set(lea.mutation)
    .send({ title: 'Vélo turquoise' })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${list.body.id as string}/items`)
    .set(lea.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  await conversations.settle();
  return { lea, paul, marc, itemId: item.body.id as string };
}

function subscribe(user: SignedIn, endpoint = ENDPOINT, showDetails?: boolean) {
  return http()
    .post('/api/v1/push-subscriptions')
    .set(user.mutation)
    .send({ endpoint, keys: KEYS, ...(showDetails === undefined ? {} : { showDetails }) });
}

async function comment(user: SignedIn, itemId: string, thread: string) {
  await http()
    .post(`/api/v1/items/${itemId}/comments`)
    .set(user.mutation)
    .send({ thread, body: 'Message' })
    .expect(201);
  await conversations.settle();
}

describe('NOT-16 : points de terminaison permis', () => {
  it('service connu accepté ; adresse quelconque, http, port ou identifiants refusés', async () => {
    const lea = await person('Léa');
    await subscribe(lea).expect(204);
    for (const endpoint of [
      'https://evil.example/push',
      'https://169.254.169.254/latest',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.example/x',
    ]) {
      const res = await subscribe(lea, endpoint).expect(422);
      expect(res.body.code).toBe('PUSH_ENDPOINT_INVALID');
    }
    await subscribe(lea, 'http://fcm.googleapis.com/x').expect(400);
  });
});

describe('NOT-06, NOT-07 : texte d’une push', () => {
  it('activité d’offreur : ni article ni personne ; le profil est nommé', async () => {
    const { paul, marc, itemId } = await world();
    await subscribe(marc).expect(204);
    await comment(marc, itemId, 'GIVERS');
    await comment(paul, itemId, 'GIVERS');
    expect(await conversations.deliverPushes()).toBe(1);
    const [push] = conversations.pushSender.sent;
    expect(push?.payload).toEqual({
      title: 'Pour Marc',
      body: 'Du nouveau sur un cadeau que vous préparez',
      tag: `profile-${marc.profileId as string}`,
      url: '/notifications',
    });
    for (const text of ['Vélo', 'turquoise', 'Paul', 'Léa', 'Noël']) {
      expect(JSON.stringify(push)).not.toContain(text);
    }
    // Une seule fois.
    expect(await conversations.deliverPushes()).toBe(0);
  });

  it('détail demandé sur l’appareil : le titre relu par le moteur', async () => {
    const { paul, marc, itemId } = await world();
    await subscribe(marc, ENDPOINT, true).expect(204);
    await comment(marc, itemId, 'GIVERS');
    await comment(paul, itemId, 'GIVERS');
    await conversations.deliverPushes();
    expect(conversations.pushSender.sent[0]?.payload.body).toBe(
      'Du nouveau sur un cadeau que vous préparez : Vélo turquoise',
    );
  });

  it('NOT-11, NOT-15 : sujet devenu invisible ou session morte : rien ne part', async () => {
    const { lea, paul, marc, itemId } = await world();
    await subscribe(marc).expect(204);
    await comment(marc, itemId, 'GIVERS');
    await comment(paul, itemId, 'GIVERS');
    const item = await http().get(`/api/v1/items/${itemId}`).set({ Cookie: lea.cookie });
    await http()
      .put(`/api/v1/items/${itemId}/visibility`)
      .set({ ...lea.mutation, 'If-Match': String(item.body.version) })
      .send({ mode: 'EXCEPT', profileIds: [marc.profileId] })
      .expect(200);
    await conversations.deliverPushes();
    expect(conversations.pushSender.sent).toEqual([]);

    await subscribe(lea, 'https://updates.push.services.mozilla.com/wpush/v2/x').expect(204);
    await comment(paul, itemId, 'PUBLIC');
    conversations.delivery.alive = (id) => id !== lea.sessionId;
    await conversations.deliverPushes();
    conversations.delivery.alive = () => true;
    expect(conversations.pushSender.sent).toEqual([]);
    expect(await conversations.push.devicesOf(lea.profileId!)).toEqual([]);
  });

  it('NOT-15 : appareil désabonné oublié ; désactivé par le profil', async () => {
    const { lea, paul, itemId } = await world();
    await subscribe(lea).expect(204);
    await http()
      .post('/api/v1/push-subscriptions/remove')
      .set(lea.mutation)
      .send({ endpoint: ENDPOINT })
      .expect(204);
    await comment(paul, itemId, 'PUBLIC');
    await conversations.deliverPushes();
    expect(conversations.pushSender.sent).toEqual([]);
  });
});

describe('NOT-08, NOT-17 : résumé e-mail', () => {
  it('un message par compte, nombre seulement, une fois par période', async () => {
    const { lea, paul, marc, itemId } = await world();
    await comment(marc, itemId, 'GIVERS');
    await comment(paul, itemId, 'GIVERS');
    await comment(paul, itemId, 'PUBLIC');
    // Les mondes des tests précédents partagent les doubles : on ne regarde que ces comptes.
    await conversations.sendDigests();
    const mine = [lea, paul, marc].map((u) => u.accountId);
    expect(conversations.delivery.digests.filter((d) => mine.includes(d.accountId))).toHaveLength(
      2,
    );
    const forLea = conversations.delivery.digests.find((d) => d.accountId === lea.accountId);
    expect(forLea?.entries).toEqual([{ profileName: 'Léa', count: 1 }]);
    const forMarc = conversations.delivery.digests.find((d) => d.accountId === marc.accountId);
    expect(forMarc?.entries).toEqual([{ profileName: 'Marc', count: 2 }]);
    conversations.delivery.digests.length = 0;
    expect(await conversations.sendDigests()).toBe(0);
  });
});
