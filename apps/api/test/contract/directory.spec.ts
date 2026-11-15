import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import { createTestApp, type TestCatalog, type TestIdentity } from './create-test-app';

// Répertoire du cercle (REP-01 à REP-10, VIS-40, critères de 04).

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

async function person(): Promise<SignedIn> {
  const user = await identity.signIn();
  identity.accounts.seed({ id: user.accountId, email: `d-${user.accountId}@lahotte.test` });
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

async function newProduct(user: SignedIn, title: string): Promise<string> {
  const res = await http().post('/api/v1/products').set(user.mutation).send({ title }).expect(201);
  return res.body.id as string;
}

function share(user: SignedIn, productId: string, body: Body) {
  return http().put(`/api/v1/products/${productId}/share`).set(user.mutation).send(body);
}

async function directory(user: SignedIn, q?: string): Promise<string[]> {
  const res = await http()
    .get(`/api/v1/directory${q ? `?q=${encodeURIComponent(q)}` : ''}`)
    .set({ Cookie: user.cookie })
    .expect(200);
  return (res.body.items as Body[]).map((e) => e.productId as string);
}

describe('Partage (REP-02, REP-08, REP-09)', () => {
  it('au cercle : visible du cercle avec qui partage, pas des autres ; dépublié aussitôt', async () => {
    const papa = await person();
    const tonton = await person();
    const stranger = await person();
    await link(papa, tonton);
    const id = await newProduct(papa, 'Lampe de bureau');
    expect(await directory(tonton)).not.toContain(id);
    await share(papa, id, { level: 'CIRCLE' }).expect(200);
    const res = await http().get('/api/v1/directory').set({ Cookie: tonton.cookie }).expect(200);
    expect(res.body.items).toContainEqual(
      expect.objectContaining({
        productId: id,
        title: 'Lampe de bureau',
        sharedBy: papa.profileId,
      }),
    );
    expect(await directory(stranger)).not.toContain(id);
    expect(await directory(papa)).not.toContain(id);
    await share(papa, id, { level: 'PRIVATE' }).expect(200);
    expect(await directory(tonton)).not.toContain(id);
  });

  it('REP-09 : catalogue global refusé ; fiche d’un autre : 404', async () => {
    const papa = await person();
    const tonton = await person();
    const id = await newProduct(papa, 'x');
    const global = await share(papa, id, { level: 'GLOBAL' });
    expect({ status: global.status, code: global.body.code }).toEqual({
      status: 422,
      code: 'GLOBAL_CATALOG_UNAVAILABLE',
    });
    await share(tonton, id, { level: 'CIRCLE' }).expect(404);
  });

  it('VIS-40 : recherche plein texte dans le répertoire du cercle', async () => {
    const papa = await person();
    const tonton = await person();
    await link(papa, tonton);
    const lamp = await newProduct(papa, 'Lampe bleue');
    const bike = await newProduct(papa, 'Vélo rouge');
    await share(papa, lamp, { level: 'CIRCLE' }).expect(200);
    await share(papa, bike, { level: 'CIRCLE' }).expect(200);
    expect(await directory(tonton, 'vélo')).toEqual([bike]);
  });
});

describe('Fiche liée à un élément caché (REP-06, REP-07, REP-10, critère de 04)', () => {
  async function hiddenWorld() {
    const papa = await person();
    const marie = await person();
    const tonton = await person();
    const mamie = await person();
    for (const other of [marie, tonton, mamie]) await link(papa, other);
    const gift = await http()
      .post('/api/v1/lists')
      .set(papa.mutation)
      .send({ type: 'GIFTLIST', title: 'Pour Marie', recipientIds: [marie.profileId] })
      .expect(201);
    const productId = await newProduct(papa, 'Vélo');
    const item = await http()
      .post(`/api/v1/lists/${gift.body.id as string}/items`)
      .set(papa.mutation)
      .send({ productId })
      .expect(201);
    return { papa, marie, tonton, mamie, productId, item: item.body as Body };
  }

  it('sans choix explicite, même par l’API : 422, rien n’est publié', async () => {
    const { papa, tonton, productId, item } = await hiddenWorld();
    await http()
      .put(`/api/v1/items/${item.id as string}/visibility`)
      .set({ ...papa.mutation, 'If-Match': '1' })
      .send({ mode: 'EXCEPT', profileIds: [tonton.profileId] })
      .expect(200);
    const res = await share(papa, productId, { level: 'CIRCLE' });
    expect({ status: res.status, code: res.body.code }).toEqual({
      status: 422,
      code: 'HIDDEN_ITEM_REQUIRES_CHOICE',
    });
    expect(catalog.products.rows.get(productId)?.shareLevel).toBe('PRIVATE');
  });

  it('« Le rendre visible de tous » : l’élément repasse en TOUS (tracé) et la fiche est publiée', async () => {
    const { papa, tonton, mamie, productId, item } = await hiddenWorld();
    await http()
      .put(`/api/v1/items/${item.id as string}/visibility`)
      .set({ ...papa.mutation, 'If-Match': '1' })
      .send({ mode: 'EXCEPT', profileIds: [tonton.profileId] })
      .expect(200);
    await share(papa, productId, {
      level: 'CIRCLE',
      hiddenItemChoice: 'MAKE_VISIBLE_TO_ALL',
    }).expect(200);
    const rule = await http()
      .get(`/api/v1/items/${item.id as string}/visibility`)
      .set({ Cookie: papa.cookie })
      .expect(200);
    expect(rule.body.mode).toBe('ALL');
    expect(await directory(tonton)).toContain(productId);
    expect(await directory(mamie)).toContain(productId);
    expect(
      catalog.visibilityLog.entries.filter((e) => e.itemId === item.id).map((e) => e.after.mode),
    ).toEqual(['EXCEPT', 'ALL']);
  });

  it('REP-10 : jamais montrée au destinataire de l’élément qui la référence ; copie refusée', async () => {
    const { papa, marie, tonton, productId } = await hiddenWorld();
    await share(papa, productId, { level: 'CIRCLE' }).expect(200);
    expect(await directory(tonton)).toContain(productId);
    expect(await directory(marie)).not.toContain(productId);
    expect(await directory(marie, 'vélo')).toEqual([]);
    const theirs = await http().post(`/api/v1/directory/${productId}/copy`).set(marie.mutation);
    const unknown = await http().post(`/api/v1/directory/${randomUUID()}/copy`).set(marie.mutation);
    expect({ status: theirs.status, code: theirs.body.code }).toEqual({
      status: unknown.status,
      code: unknown.body.code,
    });
    expect(theirs.status).toBe(404);
  });

  it('REP-05 : « ajouter à ma liste » commence par une copie au copieur', async () => {
    const { papa, tonton, productId } = await hiddenWorld();
    await share(papa, productId, { level: 'CIRCLE' }).expect(200);
    const copy = await http()
      .post(`/api/v1/directory/${productId}/copy`)
      .set(tonton.mutation)
      .expect(201);
    const copyId = copy.body.productId as string;
    expect(catalog.products.rows.get(copyId)).toMatchObject({
      ownerProfileId: tonton.profileId,
      shareLevel: 'PRIVATE',
      title: 'Vélo',
    });
  });
});
