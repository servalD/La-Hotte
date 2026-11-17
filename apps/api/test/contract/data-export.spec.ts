import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { session, type SignedIn } from '../support/sign-in';
import { createTestApp, type TestAdmin, type TestIdentity } from './create-test-app';

// Export des données d'un profil : RGPD-04, RGPD-11, VIS-20, VIS-22, SEC-04.

let app: INestApplication;
let identity: TestIdentity;
let admin: TestAdmin;

beforeAll(async () => {
  ({ app, identity, admin } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
});

const http = () => request(app.getHttpServer());
const GIVERS_SECRET = 'Je prends le vélo rouge, 120 euros chacun';

async function person(): Promise<SignedIn> {
  const user = await identity.signIn();
  identity.accounts.seed({ id: user.accountId, email: `x-${user.accountId}@lahotte.test` });
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

/** Wishlist de Léa ; Paul, de son cercle, écrit au fil des offreurs. */
async function world() {
  const lea = await person();
  const paul = await person();
  await link(lea, paul);
  const list = await http()
    .post('/api/v1/lists')
    .set(lea.mutation)
    .send({ type: 'WISHLIST', title: 'Noël de Léa', recipientIds: [lea.profileId] })
    .expect(201);
  const product = await http()
    .post('/api/v1/products')
    .set(lea.mutation)
    .send({ title: 'Vélo' })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${list.body.id as string}/items`)
    .set(lea.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  const itemId = item.body.id as string;
  await http()
    .post(`/api/v1/items/${itemId}/comments`)
    .set(paul.mutation)
    .send({ thread: 'GIVERS', body: GIVERS_SECRET })
    .expect(201);
  return { lea, paul, itemId };
}

async function exportOf(user: SignedIn): Promise<{ id: string; body: Record<string, unknown> }> {
  const fresh = await reauthenticated(user);
  const created = await http().post('/api/v1/profiles/me/export').set(fresh.mutation).expect(201);
  const id = created.body.id as string;
  const res = await http()
    .get(`/api/v1/profiles/me/export/${id}`)
    .set('Cookie', fresh.cookie)
    .expect(200);
  expect(res.headers['content-disposition']).toContain('attachment');
  expect(res.headers['cache-control']).toBe('no-store');
  return { id, body: JSON.parse(res.text) as Record<string, unknown> };
}

describe('Export des données (RGPD-11)', () => {
  it('exige une ré-authentification récente', async () => {
    const user = await person();
    const res = await http().post('/api/v1/profiles/me/export').set(user.mutation).expect(401);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
  });

  it('VIS-20 : l’export d’une destinataire ne contient rien des offreurs', async () => {
    const { lea, itemId } = await world();
    const { body } = await exportOf(lea);
    const text = JSON.stringify(body);
    expect(text).not.toContain(GIVERS_SECRET);
    const lists = body.lists as Array<{
      list: Record<string, unknown>;
      items: Array<Record<string, unknown>>;
    }>;
    const mine = lists.find((l) => l.list.title === 'Noël de Léa');
    const item = mine?.items.find((i) => i.id === itemId);
    expect(item?.view).toBe('recipient');
    for (const field of ['status', 'isSuggestion', 'visibilityMode', 'position']) {
      expect(item).not.toHaveProperty(field);
    }
    expect(body.comments).toEqual([]);
  });

  it('l’offreur retrouve son message et la vue offreur', async () => {
    const { paul, itemId } = await world();
    const { body } = await exportOf(paul);
    expect(body.comments).toEqual([
      expect.objectContaining({ itemId, thread: 'GIVERS', body: GIVERS_SECRET }),
    ]);
    const lists = body.lists as Array<{ items: Array<Record<string, unknown>> }>;
    const item = lists.flatMap((l) => l.items).find((i) => i.id === itemId);
    expect(item?.view).toBe('giver');
    expect(body).toMatchObject({ format: 'la-hotte-export/1', profile: { id: paul.profileId } });
  });

  it('un seul téléchargement, par le seul profil, et une demande par jour', async () => {
    const lea = await person();
    const other = await person();
    const fresh = await reauthenticated(lea);
    const created = await http().post('/api/v1/profiles/me/export').set(fresh.mutation).expect(201);
    const id = created.body.id as string;
    // Un autre profil : comme un inconnu (SEC-04).
    await http().get(`/api/v1/profiles/me/export/${id}`).set('Cookie', other.cookie).expect(404);
    await http().get(`/api/v1/profiles/me/export/${id}`).set('Cookie', fresh.cookie).expect(200);
    const again = await http()
      .get(`/api/v1/profiles/me/export/${id}`)
      .set('Cookie', fresh.cookie)
      .expect(404);
    expect(again.body.code).toBe('EXPORT_NOT_FOUND');
    expect(admin.exports.rows.get(id)?.payload).toBeNull();
    const limited = await http().post('/api/v1/profiles/me/export').set(fresh.mutation).expect(429);
    expect(limited.body.code).toBe('EXPORT_RATE_LIMITED');
    expect(identity.securityLog.entries.map((e) => e.event)).toEqual(
      expect.arrayContaining(['export.requested', 'export.downloaded']),
    );
  });
});
