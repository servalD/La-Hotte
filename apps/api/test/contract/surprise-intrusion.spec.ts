import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { session, type SignedIn } from '../support/sign-in';
import { createTestApp, type TestConversations, type TestIdentity } from './create-test-app';

// SEC-42 : test d'intrusion ciblé sur la surprise, pour les canaux ouverts par la phase 7.
// Léa est destinataire ; Paul participe à un de ses souhaits et en parle au fil des offreurs. Léa
// essaie tout ce qu'une destinataire curieuse peut essayer : signaler le message des offreurs pour
// en apprendre l'existence, chercher la fiche au catalogue, exporter ses données, lire les
// décisions de modération, entrer dans l'espace d'administration. Rien de ce que préparent les
// offreurs ne doit lui parvenir (VIS-20, VIS-22).

const SECRET = `SURPRISE-${randomUUID()}`;
const AMOUNT = 4_321;

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
});

const http = () => request(app.getHttpServer());
type Body = Record<string, unknown>;

async function person(): Promise<SignedIn> {
  const user = await identity.signIn();
  identity.accounts.seed({ id: user.accountId, email: `s-${user.accountId}@lahotte.test` });
  return user;
}

async function reauthenticated(user: SignedIn): Promise<SignedIn> {
  const rotated = await app.get(SessionLifecycle).rotate({
    id: user.sessionId,
    accountId: user.accountId,
    tokenHash: user.tokenHash,
  });
  return session(
    app,
    rotated.token,
    rotated.record.tokenHash,
    user.sessionId,
    user.accountId,
    rotated.record.activeProfileId,
  );
}

async function link(x: SignedIn, y: SignedIn): Promise<void> {
  const invitation = await http().post('/api/v1/invitations').set(x.mutation).send({}).expect(201);
  await http()
    .post('/api/v1/invitations/redeem')
    .set(y.mutation)
    .send({ token: invitation.body.token as string })
    .expect(201);
}

const shape = (res: request.Response) => {
  const { requestId: _r, instance: _i, ...rest } = res.body as Body;
  return { status: res.status, body: rest };
};

async function world() {
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
    .send({ title: 'Vélo', unitPriceMinor: 10_000, currency: 'EUR' })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${list.body.id as string}/items`)
    .set(lea.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  const itemId = item.body.id as string;
  await http()
    .put(`/api/v1/items/${itemId}/contribution`)
    .set({ ...paul.mutation, 'Idempotency-Key': randomUUID() })
    .send({ mode: 'FIXED', amountMinor: AMOUNT })
    .expect(200);
  const comment = await http()
    .post(`/api/v1/items/${itemId}/comments`)
    .set(paul.mutation)
    .send({ thread: 'GIVERS', body: SECRET })
    .expect(201);
  await conversations.settle();
  return { lea, paul, itemId, commentId: comment.body.id as string };
}

describe('Surprise face aux canaux de la phase 7 (SEC-42, VIS-20, VIS-22)', () => {
  it('signaler le message des offreurs répond comme pour un message qui n’existe pas', async () => {
    const { lea, commentId } = await world();
    const real = await http()
      .post('/api/v1/reports')
      .set(lea.mutation)
      .send({ targetKind: 'COMMENT', targetId: commentId, reason: 'SPAM' });
    const fake = await http()
      .post('/api/v1/reports')
      .set(lea.mutation)
      .send({ targetKind: 'COMMENT', targetId: randomUUID(), reason: 'SPAM' });
    expect(shape(real)).toEqual(shape(fake));
    expect(real.status).toBe(404);
  });

  it('l’export de la destinataire ne dit rien de la participation ni du fil des offreurs', async () => {
    const { lea } = await world();
    const fresh = await reauthenticated(lea);
    const created = await http().post('/api/v1/profiles/me/export').set(fresh.mutation).expect(201);
    const res = await http()
      .get(`/api/v1/profiles/me/export/${created.body.id as string}`)
      .set('Cookie', fresh.cookie)
      .expect(200);
    expect(res.text).not.toContain(SECRET);
    expect(res.text).not.toContain(String(AMOUNT));
    const document = JSON.parse(res.text) as Body;
    expect((document.cart as { groups: unknown[] }).groups).toEqual([]);
    expect((document.balances as { items: unknown[] }).items).toEqual([]);
  });

  it('ni le catalogue, ni la recherche, ni la modération, ni l’administration ne laissent rien voir', async () => {
    const { lea, itemId } = await world();
    const reads = [
      '/api/v1/directory',
      '/api/v1/directory/global',
      `/api/v1/directory/global?q=${encodeURIComponent(SECRET)}`,
      '/api/v1/moderation-decisions',
      '/api/v1/notifications',
      `/api/v1/items/${itemId}`,
      `/api/v1/items/${itemId}/threads`,
    ];
    for (const path of reads) {
      const res = await http().get(path).set('Cookie', lea.cookie);
      expect({ path, leaked: JSON.stringify(res.body).includes(SECRET) }).toEqual({
        path,
        leaked: false,
      });
      expect({ path, amount: JSON.stringify(res.body).includes(String(AMOUNT)) }).toEqual({
        path,
        amount: false,
      });
    }
    for (const path of ['/api/v1/admin/moderation/queue', '/api/v1/admin/stats']) {
      await http().get(path).set('Cookie', lea.cookie).expect(404);
    }
    await http()
      .get(`/api/v1/items/${itemId}/comments?thread=GIVERS`)
      .set('Cookie', lea.cookie)
      .expect(404);
  });

  it('un message des offreurs masqué par la modération ne change rien de ce que voit la destinataire', async () => {
    const { lea, itemId, commentId } = await world();
    const before = await http().get(`/api/v1/items/${itemId}/threads`).set('Cookie', lea.cookie);
    for (let i = 0; i < 3; i += 1) {
      const giver = await person();
      // Un tiers qui ne lit pas le fil ne peut pas le faire masquer.
      await http()
        .post('/api/v1/reports')
        .set(giver.mutation)
        .send({ targetKind: 'COMMENT', targetId: commentId, reason: 'SPAM' })
        .expect(404);
    }
    const after = await http().get(`/api/v1/items/${itemId}/threads`).set('Cookie', lea.cookie);
    expect(after.body).toEqual(before.body);
  });
});
