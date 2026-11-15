import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import { createTestApp, type TestCatalog, type TestIdentity } from './create-test-app';
import { PHASE2_IDOR_ROUTES } from './idor-routes';
import { listRoutes } from './routes';

// Tests transverses de la phase 2 (tranche 11) : IDOR sur toutes les routes à identifiant des
// fiches, listes, éléments et répertoire (SEC-03, VIS-34) ; aucune réponse faite à un destinataire
// ne porte de donnée d'offreur, même à `null` (VIS-20, VIS-22, critère de 04) ; giftlist cachée
// indiscernable pour son destinataire sur toutes les lectures (GFT-07, critère de 03).

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
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

async function person(): Promise<SignedIn> {
  const user = await identity.signIn();
  identity.accounts.seed({ id: user.accountId, email: `s-${user.accountId}@lahotte.test` });
  return user;
}

async function link(x: SignedIn, y: SignedIn): Promise<void> {
  const invitation = await http().post('/api/v1/invitations').set(x.mutation).send({}).expect(201);
  await http()
    .post('/api/v1/invitations/redeem')
    .set(y.mutation)
    .send({ token: invitation.body.token as string })
    .expect(201);
}

/**
 * Monde de la victime : Papa tient une giftlist cachée pour Marie et une wishlist « Mes envies »
 * avec un souhait ; une fiche partagée au cercle, une image. Tonton, du cercle de Papa, est membre
 * de la giftlist.
 */
async function world() {
  const papa = await person();
  const marie = await person();
  const tonton = await person();
  await link(papa, marie);
  await link(papa, tonton);
  const gift = await http()
    .post('/api/v1/lists')
    .set(papa.mutation)
    .send({ type: 'GIFTLIST', title: 'Pour Marie', recipientIds: [marie.profileId] })
    .expect(201);
  await http()
    .put(`/api/v1/lists/${gift.body.id as string}/members/${tonton.profileId!}`)
    .set(papa.mutation)
    .send({ role: 'CONTRIBUTOR' })
    .expect(204);
  const product = await http()
    .post('/api/v1/products')
    .set(papa.mutation)
    .send({ title: 'Vélo' })
    .expect(201);
  const giftItem = await http()
    .post(`/api/v1/lists/${gift.body.id as string}/items`)
    .set(papa.mutation)
    .send({ productId: product.body.id })
    .expect(201);
  const lists = await http().get('/api/v1/lists').set({ Cookie: papa.cookie }).expect(200);
  const personal = (lists.body.items as Body[]).find((l) => l.personal)!;
  const wishProduct = await http()
    .post('/api/v1/products')
    .set(papa.mutation)
    .send({ title: 'Livre' })
    .expect(201);
  const wish = await http()
    .post(`/api/v1/lists/${personal.id as string}/items`)
    .set(papa.mutation)
    .send({ productId: wishProduct.body.id })
    .expect(201);
  await http()
    .put(`/api/v1/products/${wishProduct.body.id as string}/share`)
    .set(papa.mutation)
    .send({ level: 'CIRCLE' })
    .expect(200);
  return {
    papa,
    marie,
    tonton,
    ids: {
      giftListId: gift.body.id as string,
      giftItemId: giftItem.body.id as string,
      productId: product.body.id as string,
      wishListId: personal.id as string,
      wishItemId: wish.body.id as string,
      sharedProductId: wishProduct.body.id as string,
      tontonId: tonton.profileId!,
    },
  };
}

function snapshot(): string {
  return JSON.stringify({
    products: [...catalog.products.rows.values()].map((p) => [
      p.id,
      p.title,
      p.shareLevel,
      p.version,
    ]),
    lists: [...catalog.lists.lists.values()].map((l) => [
      l.id,
      l.title,
      l.version,
      l.members,
      l.deletedAt,
    ]),
    items: [...catalog.items.items.values()].map((i) => [
      i.id,
      i.version,
      i.status,
      i.receivedAt,
      i.visibilityMode,
    ]),
  });
}

describe('IDOR de la phase 2 (SEC-03, VIS-34)', () => {
  it('chaque route à identifiant : la ressource d’autrui répond comme un identifiant inconnu ; rien ne change', async () => {
    const { ids, marie } = await world();
    type Ids = typeof ids;
    const table: Array<{
      route: string;
      id: keyof Ids;
      body?: Body;
      headers?: Record<string, string>;
    }> = [
      { route: 'GET /api/v1/products/:id', id: 'productId' },
      {
        route: 'PATCH /api/v1/products/:id',
        id: 'productId',
        body: { title: 'x' },
        headers: { 'If-Match': '1' },
      },
      { route: 'PUT /api/v1/products/:id/share', id: 'productId', body: { level: 'CIRCLE' } },
      { route: 'GET /api/v1/lists/:id', id: 'giftListId' },
      {
        route: 'PATCH /api/v1/lists/:id',
        id: 'giftListId',
        body: { title: 'x' },
        headers: { 'If-Match': '1' },
      },
      { route: 'DELETE /api/v1/lists/:id', id: 'giftListId' },
      { route: 'POST /api/v1/lists/:id/restore', id: 'giftListId' },
      { route: 'GET /api/v1/lists/:id/members', id: 'giftListId' },
      { route: 'POST /api/v1/lists/:id/leave', id: 'giftListId' },
      { route: 'GET /api/v1/lists/:id/items', id: 'giftListId' },
      {
        route: 'POST /api/v1/lists/:id/items',
        id: 'giftListId',
        body: { productId: randomUUID() },
      },
      { route: 'GET /api/v1/lists/:id/visibility-log', id: 'giftListId' },
      { route: 'GET /api/v1/items/:id', id: 'giftItemId' },
      {
        route: 'PATCH /api/v1/items/:id',
        id: 'giftItemId',
        body: { note: 'x' },
        headers: { 'If-Match': '1' },
      },
      { route: 'DELETE /api/v1/items/:id', id: 'giftItemId' },
      { route: 'POST /api/v1/items/:id/received', id: 'giftItemId' },
      { route: 'DELETE /api/v1/items/:id/received', id: 'giftItemId' },
      {
        route: 'POST /api/v1/items/:id/withdraw',
        id: 'giftItemId',
        body: { reason: 'ALREADY_HAVE' },
      },
      { route: 'POST /api/v1/items/:id/copy', id: 'giftItemId' },
      { route: 'GET /api/v1/items/:id/visibility', id: 'giftItemId' },
      {
        route: 'PUT /api/v1/items/:id/visibility',
        id: 'giftItemId',
        body: { mode: 'ALL', profileIds: [] },
        headers: { 'If-Match': '1' },
      },
      { route: 'POST /api/v1/directory/:productId/copy', id: 'productId' },
    ];
    // Les routes à deux paramètres sont jouées sur la liste de la victime avec un profil réel.
    const twoParams = [
      'PUT /api/v1/lists/:id/members/:profileId',
      'DELETE /api/v1/lists/:id/members/:profileId',
    ];

    // Deux attaquants : un inconnu ; Marie, destinataire de la giftlist cachée (GFT-07).
    const stranger = await person();
    const attackers = [stranger, marie];
    const before = snapshot();
    for (const attacker of attackers) {
      for (const row of table) {
        const [method, template] = row.route.split(' ') as [string, string];
        const send = (id: string) => {
          const req = http()[method.toLowerCase() as Method](template.replace(/:[A-Za-z]+/, id));
          return method === 'GET'
            ? req.set({ Cookie: attacker.cookie })
            : req.set({ ...attacker.mutation, ...(row.headers ?? {}) }).send(row.body ?? {});
        };
        const victim = await send(ids[row.id]);
        const unknown = await send(randomUUID());
        const key = row.route;
        expect({ key, status: victim.status, code: victim.body.code as unknown }).toEqual({
          key,
          status: unknown.status,
          code: unknown.body.code as unknown,
        });
        expect({ key, status: victim.status }).toEqual({ key, status: 404 });
      }
      for (const route of twoParams) {
        const [method, template] = route.split(' ') as [string, string];
        const path = (listId: string) =>
          template.replace(':id', listId).replace(':profileId', ids.tontonId);
        const victim = await http()
          [method.toLowerCase() as Method](path(ids.giftListId))
          .set(attacker.mutation)
          .send({ role: 'READER' });
        const unknown = await http()
          [method.toLowerCase() as Method](path(randomUUID()))
          .set(attacker.mutation)
          .send({ role: 'READER' });
        expect({ route, status: victim.status, code: victim.body.code as unknown }).toEqual({
          route,
          status: unknown.status,
          code: unknown.body.code as unknown,
        });
      }
    }
    // Aucune écriture (hors « Mes envies » créées à la première lecture des attaquants).
    expect(snapshot()).toEqual(before);
    // La table couvre toutes les routes à identifiant de la phase 2.
    const covered = new Set([
      ...table.map((r) => r.route),
      ...twoParams,
      'GET /api/v1/images/:key',
    ]);
    expect(PHASE2_IDOR_ROUTES.filter((route) => !covered.has(route))).toEqual([]);
  });
});

const GIVER_FIELDS =
  /^(status|isSuggestion|addedBy|shownToRecipient|intendedRecipientId|giftExistence|giftContent|reservations?|contributions?|buyer|settlement|purchase.*|members)$/;

function giverKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => giverKeys(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Body).flatMap(([key, child]) => [
      ...(GIVER_FIELDS.test(key) ? [`${path}.${key}`] : []),
      ...giverKeys(child, `${path}.${key}`),
    ]);
  }
  return [];
}

describe('Réponses faites à un destinataire (VIS-20, VIS-22, critère de 04)', () => {
  it('aucune lecture ne porte un champ d’offreur, même à null, quel que soit l’état réel', async () => {
    const marie = await person();
    const tonton = await person();
    await link(marie, tonton);
    const lists = await http().get('/api/v1/lists').set({ Cookie: marie.cookie }).expect(200);
    const listId = (lists.body.items as Body[]).find((l) => l.personal)!.id as string;
    const productRes = await http()
      .post('/api/v1/products')
      .set(marie.mutation)
      .send({ title: 'Vélo' });
    const item = await http()
      .post(`/api/v1/lists/${listId}/items`)
      .set(marie.mutation)
      .send({ productId: productRes.body.id })
      .expect(201);
    const suggestionProduct = await http()
      .post('/api/v1/products')
      .set(tonton.mutation)
      .send({ title: 'x' });
    await http()
      .post(`/api/v1/lists/${listId}/items`)
      .set(tonton.mutation)
      .send({ productId: suggestionProduct.body.id })
      .expect(201);
    for (const status of ['OPEN', 'RESERVED', 'PURCHASED'] as const) {
      catalog.items.setStatus(item.body.id as string, status);
      const responses = await Promise.all([
        http().get('/api/v1/lists').set({ Cookie: marie.cookie }),
        http().get(`/api/v1/lists/${listId}`).set({ Cookie: marie.cookie }),
        http().get(`/api/v1/lists/${listId}/items`).set({ Cookie: marie.cookie }),
        http().get(`/api/v1/lists/${listId}/items?sort=added`).set({ Cookie: marie.cookie }),
        http()
          .get(`/api/v1/items/${item.body.id as string}`)
          .set({ Cookie: marie.cookie }),
        http()
          .post(`/api/v1/items/${item.body.id as string}/received`)
          .set(marie.mutation),
        http()
          .delete(`/api/v1/items/${item.body.id as string}/received`)
          .set(marie.mutation),
        http().get('/api/v1/directory').set({ Cookie: marie.cookie }),
      ]);
      for (const [index, res] of responses.entries()) {
        expect(res.status).toBeLessThan(300);
        // `members` n'est lu que par GET /lists/{id}/members, hors de ces réponses.
        expect({ url: index, leaks: giverKeys(res.body) }).toEqual({
          url: index,
          leaks: [],
        });
      }
      const items = await http().get(`/api/v1/lists/${listId}/items`).set({ Cookie: marie.cookie });
      expect((items.body.items as Body[]).map((i) => i.id)).toEqual([item.body.id]); // pas la suggestion
    }
  });
});

describe('Matrice de 04 : offreur du même compte que le destinataire', () => {
  it('voit en offreur TOUS et le caché autorisé, pas le caché exclu ; les réservations, oui', async () => {
    const marie = await person();
    // Un autre profil du compte de Marie, avec sa propre session.
    const sibling = await identity.signIn();
    const siblingId = sibling.profileId!;
    const row = identity.accounts.profiles.get(siblingId)!;
    identity.accounts.profiles.set(siblingId, { ...row, accountId: marie.accountId });
    identity.profiles.set({
      profileId: siblingId,
      accountId: marie.accountId,
      hasPin: false,
      relock: 'IDLE_15',
    });
    const { signIn } = await import('../support/sign-in');
    const brother = await signIn(app, { accountId: marie.accountId, profileId: siblingId });

    const lists = await http().get('/api/v1/lists').set({ Cookie: marie.cookie }).expect(200);
    const listId = (lists.body.items as Body[]).find((l) => l.personal)!.id as string;
    const add = async (title: string) => {
      const p = await http().post('/api/v1/products').set(marie.mutation).send({ title });
      const i = await http()
        .post(`/api/v1/lists/${listId}/items`)
        .set(marie.mutation)
        .send({ productId: p.body.id })
        .expect(201);
      return i.body as Body;
    };
    const open = await add('Tous');
    const allowed = await add('Caché autorisé');
    const excluded = await add('Caché exclu');
    await http()
      .put(`/api/v1/items/${allowed.id as string}/visibility`)
      .set({ ...marie.mutation, 'If-Match': '1' })
      .send({ mode: 'ONLY', profileIds: [siblingId] })
      .expect(200);
    await http()
      .put(`/api/v1/items/${excluded.id as string}/visibility`)
      .set({ ...marie.mutation, 'If-Match': '1' })
      .send({ mode: 'EXCEPT', profileIds: [siblingId] })
      .expect(200);
    catalog.items.setStatus(open.id as string, 'RESERVED');
    const seen = await http()
      .get(`/api/v1/lists/${listId}/items`)
      .set({ Cookie: brother.cookie })
      .expect(200);
    const byId = new Map((seen.body.items as Body[]).map((i) => [i.id, i]));
    expect([...byId.keys()].sort()).toEqual([open.id, allowed.id].sort());
    expect(byId.get(open.id)).toMatchObject({ view: 'giver', status: 'RESERVED' });
  });
});

describe('Giftlist cachée indiscernable (GFT-07, critère de 03)', () => {
  it('toutes les lectures de son destinataire sont identiques, avec ou sans la giftlist', async () => {
    const papa = await person();
    const marie = await person();
    await link(papa, marie);
    // Les lectures du destinataire sans paramètre ; l'identifiant d'une ressource cachée a déjà son
    // test (IDOR ci-dessus).
    const reads = listRoutes(app)
      .filter(
        (route) =>
          route.method === 'GET' && !route.path.includes('/:') && route.marks.includes('profile'),
      )
      .map((route) => route.path);
    expect(reads).toEqual(
      expect.arrayContaining(['/api/v1/lists', '/api/v1/directory', '/api/v1/products']),
    );
    const strip = (body: unknown) =>
      JSON.parse(JSON.stringify(body).replace(/"requestId":"[^"]*"/g, '""')) as unknown;
    const read = async () =>
      Promise.all(
        reads.map(async (path) =>
          strip((await http().get(path).set({ Cookie: marie.cookie })).body),
        ),
      );
    const before = await read();
    const gift = await http()
      .post('/api/v1/lists')
      .set(papa.mutation)
      .send({ type: 'GIFTLIST', title: 'Pour Marie', recipientIds: [marie.profileId] })
      .expect(201);
    const product = await http()
      .post('/api/v1/products')
      .set(papa.mutation)
      .send({ title: 'Vélo' });
    await http()
      .post(`/api/v1/lists/${gift.body.id as string}/items`)
      .set(papa.mutation)
      .send({ productId: product.body.id })
      .expect(201);
    await http()
      .put(`/api/v1/products/${product.body.id as string}/share`)
      .set(papa.mutation)
      .send({ level: 'CIRCLE' })
      .expect(200);
    expect(await read()).toEqual(before);
  });
});
