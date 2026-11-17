import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import { createTestApp, type TestCatalog, type TestIdentity } from './create-test-app';

// API-16, OFF-17 à OFF-19 (ADR 0020) : les actions qu'un client met en file hors ligne exigent une
// clé ; rejouées, elles n'agissent qu'une fois et rendent la première réponse.

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

/** En-têtes d'une mutation sans clé, ou avec la clé donnée. */
function headers(user: SignedIn, key?: string): Record<string, string> {
  const { 'Idempotency-Key': _fresh, ...rest } = user.mutation;
  return key === undefined ? rest : { ...rest, 'Idempotency-Key': key };
}

async function world() {
  const lea = await identity.signIn();
  const list = await http()
    .post('/api/v1/lists')
    .set(lea.mutation)
    .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [lea.profileId] })
    .expect(201);
  const listId = list.body.id as string;
  const product = await http()
    .post('/api/v1/products')
    .set(lea.mutation)
    .send({ title: 'Vélo', unitPriceMinor: 4900, currency: 'EUR' })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${listId}/items`)
    .set(lea.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  return { lea, listId, itemId: item.body.id as string, productId: product.body.id as string };
}

describe('Clé exigée sur les actions en file (API-16, OFF-17)', () => {
  it('sans clé, ou avec une clé mal formée : 422 IDEMPOTENCY_KEY_REQUIRED, rien n’est écrit', async () => {
    const { lea, listId, itemId, productId } = await world();
    const before = catalog.items.items.size;
    const routes: [string, string, Body][] = [
      ['post', '/api/v1/products', { title: 'Livre' }],
      ['post', `/api/v1/lists/${listId}/items`, { productId }],
      ['post', `/api/v1/items/${itemId}/comments`, { thread: 'PUBLIC', body: 'Taille ?' }],
      ['post', `/api/v1/items/${itemId}/received`, {}],
      ['delete', `/api/v1/items/${itemId}/received`, {}],
      ['delete', `/api/v1/items/${itemId}`, {}],
    ];
    for (const [method, path, body] of routes) {
      for (const key of [undefined, 'court', 'avec espace ici']) {
        const res = await http()
          [method as 'post' | 'delete'](path)
          .set(key === undefined ? headers(lea) : headers(lea, key))
          .send(body);
        expect({ path, key, status: res.status, code: res.body.code }).toEqual({
          path,
          key,
          status: 422,
          code: 'IDEMPOTENCY_KEY_REQUIRED',
        });
      }
    }
    expect(catalog.items.items.size).toBe(before);
    const patch = await http()
      .patch(`/api/v1/items/${itemId}`)
      .set({ ...headers(lea), 'If-Match': '1' })
      .send({ note: 'Bleu' });
    expect(patch.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('Rejeu (OFF-19, critère « une action rejouée trois fois n’a d’effet qu’une fois »)', () => {
  it('un commentaire envoyé trois fois avec la même clé n’est écrit qu’une fois', async () => {
    const { lea, itemId } = await world();
    const key = randomUUID();
    const send = () =>
      http()
        .post(`/api/v1/items/${itemId}/comments`)
        .set(headers(lea, key))
        .send({ thread: 'PUBLIC', body: 'Plutôt en bleu' });
    const first = await send().expect(201);
    const second = await send().expect(201);
    const third = await send().expect(201);
    expect(second.body).toEqual(first.body);
    expect(third.body).toEqual(first.body);
    const read = await http()
      .get(`/api/v1/items/${itemId}/comments?thread=PUBLIC`)
      .set({ Cookie: lea.cookie })
      .expect(200);
    expect((read.body.items as Body[]).filter((c) => c.body === 'Plutôt en bleu')).toHaveLength(1);
  });

  it('un souhait ajouté deux fois avec les mêmes clés n’entre qu’une fois dans la liste', async () => {
    const { lea, listId } = await world();
    const productKey = randomUUID();
    const itemKey = randomUUID();
    const add = async () => {
      const product = await http()
        .post('/api/v1/products')
        .set(headers(lea, productKey))
        .send({ title: 'Casque' })
        .expect(201);
      return http()
        .post(`/api/v1/lists/${listId}/items`)
        .set(headers(lea, itemKey))
        .send({ productId: product.body.id as string })
        .expect(201);
    };
    const first = await add();
    const again = await add();
    expect(again.body.id).toBe(first.body.id);
    const items = await http()
      .get(`/api/v1/lists/${listId}/items`)
      .set({ Cookie: lea.cookie })
      .expect(200);
    expect(
      (items.body.items as Body[]).filter((i) => (i.product as Body).title === 'Casque'),
    ).toHaveLength(1);
  });

  it('un retrait rejoué rend la même réponse (204), sans erreur ni second effet', async () => {
    const { lea, itemId } = await world();
    const key = randomUUID();
    await http().delete(`/api/v1/items/${itemId}`).set(headers(lea, key)).expect(204);
    await http().delete(`/api/v1/items/${itemId}`).set(headers(lea, key)).expect(204);
  });

  it('même clé, autre requête : 409 IDEMPOTENCY_KEY_REUSED ; la clé est propre au profil', async () => {
    const { lea, itemId } = await world();
    const key = randomUUID();
    await http()
      .post(`/api/v1/items/${itemId}/comments`)
      .set(headers(lea, key))
      .send({ thread: 'PUBLIC', body: 'Un' })
      .expect(201);
    const other = await http()
      .post(`/api/v1/items/${itemId}/comments`)
      .set(headers(lea, key))
      .send({ thread: 'PUBLIC', body: 'Deux' });
    expect({ status: other.status, code: other.body.code }).toEqual({
      status: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    // Un autre profil n'est pas gêné par la même clé (portée : le profil actif, CPT-71).
    const { lea: someone } = await world();
    await http()
      .post('/api/v1/products')
      .set(headers(someone, key))
      .send({ title: 'Livre' })
      .expect(201);
  });

  it('une action refusée libère sa clé : un nouvel essai est de nouveau évalué', async () => {
    const { lea, itemId } = await world();
    const key = randomUUID();
    const invalid = await http()
      .post(`/api/v1/items/${itemId}/comments`)
      .set(headers(lea, key))
      .send({ thread: 'NOPE', body: '' });
    expect(invalid.status).toBe(400);
    await http()
      .post(`/api/v1/items/${itemId}/comments`)
      .set(headers(lea, key))
      .send({ thread: 'NOPE', body: '' })
      .expect(400);
  });
});
