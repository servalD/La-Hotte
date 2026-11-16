import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, type TestCatalog, type TestIdentity } from './create-test-app';

// Fiches article (ART-01 à ART-06, EXT-20, EXT-47).

let app: INestApplication;
let identity: TestIdentity;
let catalog: TestCatalog;

beforeAll(async () => {
  ({ app, identity, catalog } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());
const titles = (res: request.Response): string[] =>
  (res.body as { items: { title: string }[] }).items.map((p) => p.title);

describe('POST /products (EXT-20)', () => {
  it('seul le titre est obligatoire ; prix absent = prix libre ; EUR par défaut', async () => {
    const user = await identity.signIn();
    const res = await http()
      .post('/api/v1/products')
      .set(user.mutation)
      .send({ title: '  Vélo rouge  ' })
      .expect(201);
    expect(res.body).toMatchObject({
      title: 'Vélo rouge',
      description: '',
      unitPriceMinor: null,
      currency: 'EUR',
      source: 'MANUAL',
      shareLevel: 'PRIVATE',
      extractionStatus: 'NONE',
      version: 1,
    });
    expect(catalog.products.rows.get(res.body.id as string)?.ownerProfileId).toBe(user.profileId);
  });

  it.each<[Record<string, unknown>, string]>([
    [{}, 'titre absent'],
    [{ title: '   ' }, 'titre vide'],
    [{ title: 'x'.repeat(201) }, 'titre trop long'],
    [{ title: 'Vélo', unitPriceMinor: -1 }, 'prix négatif'],
    [{ title: 'Vélo', unitPriceMinor: 19.99 }, 'prix non entier (ART-11)'],
    [{ title: 'Vélo', currency: 'eur' }, 'devise non ISO'],
    [{ title: 'Vélo', sourceUrl: 'javascript:alert(1)' }, 'URL non web'],
    [{ title: 'Vélo', ownerProfileId: randomUUID() }, 'champ inconnu'],
  ])('400 : %j (%s)', async (body) => {
    const user = await identity.signIn();
    await http().post('/api/v1/products').set(user.mutation).send(body).expect(400);
  });

  it('sans session : 401 ; profil verrouillé : 423', async () => {
    await http().post('/api/v1/products').send({ title: 'Vélo' }).expect(401);
    await http().get('/api/v1/products').expect(401);
    const locked = await identity.signIn({ pin: true });
    await http().get('/api/v1/products').set({ Cookie: locked.cookie }).expect(423);
  });
});

describe('GET/PATCH /products/{id} (ART-03, ART-05)', () => {
  it('le propriétaire lit et modifie ; If-Match exigé ; version dépassée : 412', async () => {
    const user = await identity.signIn();
    const created = await http()
      .post('/api/v1/products')
      .set(user.mutation)
      .send({ title: 'Livre', unitPriceMinor: 1999 })
      .expect(201);
    const id = created.body.id as string;
    const read = await http()
      .get(`/api/v1/products/${id}`)
      .set({ Cookie: user.cookie })
      .expect(200);
    expect(read.headers.etag).toBe('"1"');

    await http()
      .patch(`/api/v1/products/${id}`)
      .set(user.mutation)
      .send({ title: 'x' })
      .expect(400);
    const updated = await http()
      .patch(`/api/v1/products/${id}`)
      .set({ ...user.mutation, 'If-Match': '"1"' })
      .send({ title: 'Livre de poche', unitPriceMinor: null, merchant: 'Librairie' })
      .expect(200);
    expect(updated.body).toMatchObject({
      title: 'Livre de poche',
      unitPriceMinor: null,
      merchant: 'Librairie',
      version: 2,
    });
    const stale = await http()
      .patch(`/api/v1/products/${id}`)
      .set({ ...user.mutation, 'If-Match': '"1"' })
      .send({ title: 'Autre' })
      .expect(412);
    expect(stale.body.code).toBe('VERSION_MISMATCH');
  });

  it('ART-05 : la fiche d’un autre profil, même du même compte, répond comme une fiche inconnue', async () => {
    const owner = await identity.signIn();
    const other = await identity.signIn();
    const created = await http()
      .post('/api/v1/products')
      .set(owner.mutation)
      .send({ title: 'Secret' })
      .expect(201);
    const id = created.body.id as string;
    const theirs = await http().get(`/api/v1/products/${id}`).set({ Cookie: other.cookie });
    const unknown = await http()
      .get(`/api/v1/products/${randomUUID()}`)
      .set({ Cookie: other.cookie });
    expect({ status: theirs.status, code: theirs.body.code }).toEqual({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
    expect(unknown.status).toBe(404);
    await http()
      .patch(`/api/v1/products/${id}`)
      .set({ ...other.mutation, 'If-Match': '1' })
      .send({ title: 'Volé' })
      .expect(404);
    expect(catalog.products.rows.get(id)?.title).toBe('Secret');
  });

  it('GET /products : mes fiches seulement, paginées par curseur (API-15)', async () => {
    const user = await identity.signIn();
    const other = await identity.signIn();
    await http().post('/api/v1/products').set(other.mutation).send({ title: 'Pas à moi' });
    for (const title of ['A', 'B', 'C']) {
      await http().post('/api/v1/products').set(user.mutation).send({ title }).expect(201);
    }
    const first = await http()
      .get('/api/v1/products?limit=2')
      .set({ Cookie: user.cookie })
      .expect(200);
    expect(titles(first)).toEqual(['C', 'B']);
    const second = await http()
      .get(`/api/v1/products?limit=2&cursor=${first.body.nextCursor as string}`)
      .set({ Cookie: user.cookie })
      .expect(200);
    expect(titles(second)).toEqual(['A']);
    expect(second.body.nextCursor).toBeNull();
    await http().get('/api/v1/products?cursor=abc').set({ Cookie: user.cookie }).expect(400);
  });
});

describe('GET /images/{key} (EXT-47)', () => {
  it('servie à un profil actif par sa clé ; clé inconnue ou mal formée : 404', async () => {
    const user = await identity.signIn();
    const key = await catalog.images.put(Buffer.from('RIFF....WEBP'), 'image/webp');
    const res = await http().get(`/api/v1/images/${key}`).set({ Cookie: user.cookie }).expect(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    await http()
      .get(`/api/v1/images/${'0'.repeat(32)}`)
      .set({ Cookie: user.cookie })
      .expect(404);
    await http().get('/api/v1/images/..%2F..%2Fetc').set({ Cookie: user.cookie }).expect(404);
    await http().get(`/api/v1/images/${key}`).expect(401);
  });
});
