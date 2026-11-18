import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import {
  createTestApp,
  type TestAdmin,
  type TestCatalog,
  type TestIdentity,
} from './create-test-app';

// Catalogue global : MOD-05, MOD-06, MOD-09, MOD-12, REP-04, REP-06, REP-10, VIS-40.

let app: INestApplication;
let identity: TestIdentity;
let catalog: TestCatalog;
let admin: TestAdmin;

beforeAll(async () => {
  ({ app, identity, catalog, admin } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
  admin.settings.values = { ...admin.settings.values, forbidden_terms: [], blocked_domains: [] };
});

const http = () => request(app.getHttpServer());
type Body = Record<string, unknown>;

async function person(options: { isChild?: boolean } = {}): Promise<SignedIn> {
  const user = await identity.signIn(options);
  identity.accounts.seed({ id: user.accountId, email: `g-${user.accountId}@lahotte.test` });
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
 * Fiche comme si elle venait d'un lien marchand extrait avec succès (MOD-06) ; `photo` : image prise
 * par l'utilisateur (REP-04).
 */
async function linkProduct(
  user: SignedIn,
  title: string,
  url: string,
  options: { photo?: boolean } = {},
): Promise<string> {
  const res = await http().post('/api/v1/products').set(user.mutation).send({ title }).expect(201);
  const id = res.body.id as string;
  const row = catalog.products.rows.get(id);
  if (!row) throw new Error('fiche absente');
  catalog.products.rows.set(id, {
    ...row,
    source: 'LINK',
    extractionStatus: 'DONE',
    sourceUrl: url,
    normalizedUrl: url,
    imageKey: options.photo ? 'a'.repeat(32) : 'b'.repeat(32),
    imageFromPhoto: options.photo === true,
  });
  return id;
}

function share(user: SignedIn, productId: string, body: Body) {
  return http().put(`/api/v1/products/${productId}/share`).set(user.mutation).send(body);
}

async function global(user: SignedIn, q?: string): Promise<Body[]> {
  const res = await http()
    .get(`/api/v1/directory/global${q ? `?q=${encodeURIComponent(q)}` : ''}`)
    .set({ Cookie: user.cookie })
    .expect(200);
  return res.body.items as Body[];
}

describe('Publication au catalogue global (MOD-06, MOD-12)', () => {
  it('lien extrait : visible de tous, sans auteur ; le propriétaire ne s’y voit pas', async () => {
    const papa = await person();
    const stranger = await person();
    const id = await linkProduct(papa, 'Tente quatre places', 'https://boutique.example/tente');
    await share(papa, id, { level: 'GLOBAL' }).expect(200);
    expect(catalog.products.rows.get(id)?.moderationStatus).toBe('APPROVED');
    const entry = (await global(stranger)).find((e) => e.productId === id);
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {}).sort()).toEqual(
      [
        'adopters',
        'currency',
        'description',
        'imageKey',
        'merchant',
        'productId',
        'sourceUrl',
        'title',
        'unitPriceMinor',
      ].sort(),
    );
    expect(JSON.stringify(entry)).not.toContain(papa.profileId);
    expect((await global(papa)).map((e) => e.productId)).not.toContain(id);
  });

  it('saisie à la main : en file, invisible du catalogue', async () => {
    const papa = await person();
    const stranger = await person();
    const res = await http().post('/api/v1/products').set(papa.mutation).send({ title: 'Pull' });
    const id = res.body.id as string;
    await share(papa, id, { level: 'GLOBAL' }).expect(200);
    expect(catalog.products.rows.get(id)?.moderationStatus).toBe('PENDING');
    expect((await global(stranger)).map((e) => e.productId)).not.toContain(id);
  });

  it('MOD-09 : terme interdit ou domaine bloqué, en file', async () => {
    const papa = await person();
    admin.settings.values = {
      ...admin.settings.values,
      forbidden_terms: ['contrefacon'],
      blocked_domains: ['louche.example'],
    };
    const fake = await linkProduct(papa, 'Sac contrefaçon', 'https://boutique.example/sac');
    const shady = await linkProduct(papa, 'Montre', 'https://www.louche.example/montre');
    await share(papa, fake, { level: 'GLOBAL' }).expect(200);
    await share(papa, shady, { level: 'GLOBAL' }).expect(200);
    expect(catalog.products.rows.get(fake)?.moderationStatus).toBe('PENDING');
    expect(catalog.products.rows.get(shady)?.moderationStatus).toBe('PENDING');
  });

  it('un contenu changé après publication repasse par la file', async () => {
    const papa = await person();
    const id = await linkProduct(papa, 'Lampe', 'https://boutique.example/lampe');
    await share(papa, id, { level: 'GLOBAL' }).expect(200);
    const version = catalog.products.rows.get(id)?.version ?? 0;
    await http()
      .patch(`/api/v1/products/${id}`)
      .set({ ...papa.mutation, 'If-Match': `"${version}"` })
      .send({ title: 'Lampe (édition)' })
      .expect(200);
    expect(catalog.products.rows.get(id)?.moderationStatus).toBe('PENDING');
  });

  it('dépublier efface le statut, sauf un retrait de la modération', async () => {
    const papa = await person();
    const id = await linkProduct(papa, 'Tapis', 'https://boutique.example/tapis');
    await share(papa, id, { level: 'GLOBAL' }).expect(200);
    await share(papa, id, { level: 'PRIVATE' }).expect(200);
    expect(catalog.products.rows.get(id)?.moderationStatus).toBe('NONE');
    const row = catalog.products.rows.get(id);
    if (!row) throw new Error('fiche absente');
    catalog.products.rows.set(id, { ...row, moderationStatus: 'REJECTED' });
    await share(papa, id, { level: 'GLOBAL' }).expect(200);
    expect(catalog.products.rows.get(id)?.moderationStatus).toBe('PENDING');
  });

  it('refusé à un profil enfant et à un compte dont la publication est suspendue', async () => {
    const child = await person({ isChild: true });
    const childProduct = await linkProduct(child, 'Jeu', 'https://boutique.example/jeu');
    const res = await share(child, childProduct, { level: 'GLOBAL' }).expect(403);
    expect(res.body.code).toBe('CHILD_PUBLICATION_FORBIDDEN');
    const papa = await person();
    catalog.publishers.suspended.add(papa.profileId ?? '');
    const id = await linkProduct(papa, 'Ballon', 'https://boutique.example/ballon');
    const suspended = await share(papa, id, { level: 'GLOBAL' }).expect(403);
    expect(suspended.body.code).toBe('PUBLICATION_SUSPENDED');
    // Le cercle reste permis.
    await share(papa, id, { level: 'CIRCLE' }).expect(200);
  });
});

describe('Dédoublonnage et compteur (MOD-05)', () => {
  it('une même page une seule fois, comptée par compte', async () => {
    const a = await person();
    const b = await person();
    const viewer = await person();
    const url = `https://boutique.example/velo-${a.accountId}`;
    const first = await linkProduct(a, 'Vélo', url);
    const second = await linkProduct(b, 'Vélo', url);
    await share(a, first, { level: 'GLOBAL' }).expect(200);
    await share(b, second, { level: 'GLOBAL' }).expect(200);
    const entries = (await global(viewer)).filter((e) => e.sourceUrl === url);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ productId: first, adopters: 2 });
  });
});

describe('Ce que le catalogue ne montre pas (REP-04, REP-10)', () => {
  it('la photo prise par l’auteur ne sort pas, ni dans la liste ni dans la copie', async () => {
    const papa = await person();
    const stranger = await person();
    const id = await linkProduct(papa, 'Vase', 'https://boutique.example/vase', { photo: true });
    await share(papa, id, { level: 'GLOBAL' }).expect(200);
    const entry = (await global(stranger)).find((e) => e.productId === id);
    expect(entry?.imageKey).toBeNull();
    const copy = await http()
      .post(`/api/v1/directory/${id}/copy`)
      .set(stranger.mutation)
      .expect(201);
    const copied = catalog.products.rows.get(copy.body.productId as string);
    expect(copied).toMatchObject({ imageKey: null, imageFromPhoto: false, shareLevel: 'PRIVATE' });
  });

  it('REP-10 : jamais au destinataire d’un élément qui référence la fiche', async () => {
    const papa = await person();
    const marie = await person();
    await link(papa, marie);
    const gift = await http()
      .post('/api/v1/lists')
      .set(papa.mutation)
      .send({ type: 'GIFTLIST', title: 'Pour Marie', recipientIds: [marie.profileId] })
      .expect(201);
    const id = await linkProduct(
      papa,
      'Casque',
      `https://boutique.example/casque-${papa.accountId}`,
    );
    await http()
      .post(`/api/v1/lists/${gift.body.id as string}/items`)
      .set(papa.mutation)
      .send({ productId: id })
      .expect(201);
    await share(papa, id, { level: 'GLOBAL' }).expect(200);
    expect((await global(marie)).map((e) => e.productId)).not.toContain(id);
    await http().post(`/api/v1/directory/${id}/copy`).set(marie.mutation).expect(404);
  });

  it('VIS-40 : recherche plein texte', async () => {
    const papa = await person();
    const viewer = await person();
    const lamp = await linkProduct(
      papa,
      'Lampe bleue',
      `https://boutique.example/l-${papa.accountId}`,
    );
    const bike = await linkProduct(
      papa,
      'Vélo rouge',
      `https://boutique.example/v-${papa.accountId}`,
    );
    await share(papa, lamp, { level: 'GLOBAL' }).expect(200);
    await share(papa, bike, { level: 'GLOBAL' }).expect(200);
    const found = (await global(viewer, 'lampe')).map((e) => e.productId);
    expect(found).toContain(lamp);
    expect(found).not.toContain(bike);
  });
});
