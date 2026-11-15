import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signIn, type SignedIn } from '../support/sign-in';
import { createTestApp, type TestCatalog, type TestIdentity } from './create-test-app';

// Listes et éléments (LST-01 à LST-20, WSH-01 à WSH-07, GFT-01 à GFT-10, VIS-20, VIS-34).

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

/** Lien accepté entre deux profils de comptes différents (LNK-06). */
async function link(x: SignedIn, y: SignedIn): Promise<void> {
  const invitation = await http().post('/api/v1/invitations').set(x.mutation).send({}).expect(201);
  await http()
    .post('/api/v1/invitations/redeem')
    .set(y.mutation)
    .send({ token: invitation.body.token as string })
    .expect(201);
}

async function person(displayName = 'Profil'): Promise<SignedIn> {
  const user = await identity.signIn({ displayName });
  identity.accounts.seed({ id: user.accountId, email: `p-${user.accountId}@lahotte.test` });
  return user;
}

/** Autre profil du même compte (PRO-01), avec sa session. */
async function sibling(owner: SignedIn, isChild = false): Promise<SignedIn> {
  const profileId = randomUUID();
  identity.profiles.set({
    profileId,
    accountId: owner.accountId,
    hasPin: false,
    relock: 'IDLE_15',
  });
  const created = identity.accounts.profiles.get(profileId);
  if (created) identity.accounts.profiles.set(profileId, { ...created, isChild });
  return signIn(app, { accountId: owner.accountId, profileId });
}

async function product(user: SignedIn, title = 'Vélo', unitPriceMinor = 19999): Promise<string> {
  const res = await http()
    .post('/api/v1/products')
    .set(user.mutation)
    .send({ title, unitPriceMinor })
    .expect(201);
  return res.body.id as string;
}

async function personalList(user: SignedIn): Promise<Body> {
  const res = await http().get('/api/v1/lists').set({ Cookie: user.cookie }).expect(200);
  return (res.body.items as Body[]).find((l) => l.personal === true && l.view === 'recipient')!;
}

async function addItem(user: SignedIn, listId: string, body: Body = {}): Promise<Body> {
  const res = await http()
    .post(`/api/v1/lists/${listId}/items`)
    .set(user.mutation)
    .send({ productId: await product(user), ...body })
    .expect(201);
  return res.body as Body;
}

async function items(user: SignedIn, listId: string): Promise<Body[]> {
  const res = await http()
    .get(`/api/v1/lists/${listId}/items`)
    .set({ Cookie: user.cookie })
    .expect(200);
  return res.body.items as Body[];
}

async function createGiftlist(
  user: SignedIn,
  recipientIds: string[],
  extra: Body = {},
): Promise<Body> {
  const res = await http()
    .post('/api/v1/lists')
    .set(user.mutation)
    .send({ type: 'GIFTLIST', title: 'Pour Marie', recipientIds, ...extra })
    .expect(201);
  return res.body as Body;
}

const RESERVATION_FIELDS = [
  'status',
  'isSuggestion',
  'addedBy',
  'shownToRecipient',
  'intendedRecipientId',
];

describe('« Mes envies » (WSH-02, WSH-06, VIS-02)', () => {
  it('créée à la première lecture, une seule, destinataire et créateur, audience du cercle', async () => {
    const marie = await person('Marie');
    await http().get('/api/v1/lists').set({ Cookie: marie.cookie }).expect(200);
    const res = await http().get('/api/v1/lists').set({ Cookie: marie.cookie }).expect(200);
    const mine = (res.body.items as Body[]).filter((l) => l.personal);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      view: 'recipient',
      title: 'Mes envies',
      myRole: 'CREATOR',
      audience: 'CIRCLE',
      recipients: [marie.profileId],
    });
    expect(mine[0]).not.toHaveProperty('giftExistence');
  });

  it('LST-20 : ni supprimée, ni archivée, ni quittée', async () => {
    const marie = await person();
    const list = await personalList(marie);
    const del = await http()
      .delete(`/api/v1/lists/${list.id as string}`)
      .set(marie.mutation);
    expect(del.body.code).toBe('PERSONAL_LIST_LOCKED');
    const archive = await http()
      .patch(`/api/v1/lists/${list.id as string}`)
      .set({ ...marie.mutation, 'If-Match': String(list.version) })
      .send({ archived: true });
    expect(archive.body.code).toBe('PERSONAL_LIST_LOCKED');
  });
});

describe('Surprise sur une wishlist (VIS-20, LST-16, LST-17, critère de 03)', () => {
  it('le cercle voit en offreur ; le destinataire voit le même état neutre, avant ou après réservation', async () => {
    const marie = await person('Marie');
    const tonton = await person('Tonton');
    await link(marie, tonton);
    const list = await personalList(marie);
    const item = await addItem(marie, list.id as string);
    expect(item.view).toBe('recipient');

    const before = (await items(marie, list.id as string))[0]!;
    catalog.items.setStatus(item.id as string, 'RESERVED');
    const reserved = (await items(marie, list.id as string))[0]!;
    catalog.items.setStatus(item.id as string, 'PURCHASED');
    const purchased = (await items(marie, list.id as string))[0]!;
    expect(reserved).toEqual(before);
    expect(purchased).toEqual(before);
    for (const field of RESERVATION_FIELDS) {
      expect(before).not.toHaveProperty(field);
    }
    const single = await http()
      .get(`/api/v1/items/${item.id as string}`)
      .set({ Cookie: marie.cookie })
      .expect(200);
    for (const field of RESERVATION_FIELDS) expect(single.body).not.toHaveProperty(field);

    const giverSees = (await items(tonton, list.id as string))[0]!;
    expect(giverSees).toMatchObject({ view: 'giver', status: 'PURCHASED' });
  });

  it('LST-18 : le reçu se coche, se décoche, se voit en vert des offreurs ; l’état réel reste', async () => {
    const marie = await person();
    const tonton = await person();
    await link(marie, tonton);
    const list = await personalList(marie);
    const item = await addItem(marie, list.id as string);
    catalog.items.setStatus(item.id as string, 'PURCHASED');
    const got = await http()
      .post(`/api/v1/items/${item.id as string}/received`)
      .set(marie.mutation)
      .expect(200);
    expect(got.body).toMatchObject({ view: 'recipient', received: true });
    expect((await items(tonton, list.id as string))[0]).toMatchObject({ status: 'RECEIVED' });
    await http()
      .delete(`/api/v1/items/${item.id as string}/received`)
      .set(marie.mutation)
      .expect(200);
    expect((await items(tonton, list.id as string))[0]).toMatchObject({ status: 'PURCHASED' });
    // Un offreur ne coche pas le reçu.
    await http()
      .post(`/api/v1/items/${item.id as string}/received`)
      .set(tonton.mutation)
      .expect(403);
  });

  it('WSH-04, WSH-07 : une suggestion est vue des offreurs, jamais du destinataire', async () => {
    const marie = await person();
    const tonton = await person();
    const mamie = await person();
    await link(marie, tonton);
    await link(marie, mamie);
    const list = await personalList(marie);
    const suggestion = await addItem(tonton, list.id as string);
    expect(suggestion).toMatchObject({ view: 'giver', isSuggestion: true });
    expect(await items(marie, list.id as string)).toEqual([]);
    await http()
      .get(`/api/v1/items/${suggestion.id as string}`)
      .set({ Cookie: marie.cookie })
      .expect(404);
    expect(await items(mamie, list.id as string)).toHaveLength(1);
    // Modifiable par son auteur seul.
    await http()
      .patch(`/api/v1/items/${suggestion.id as string}`)
      .set({ ...mamie.mutation, 'If-Match': '1' })
      .send({ note: 'x' })
      .expect(403);
  });

  it('LST-15, LST-19 : un souhait retiré disparaît pour tous', async () => {
    const marie = await person();
    const tonton = await person();
    await link(marie, tonton);
    const list = await personalList(marie);
    const item = await addItem(marie, list.id as string);
    await http()
      .post(`/api/v1/items/${item.id as string}/withdraw`)
      .set(marie.mutation)
      .send({ reason: 'ALREADY_HAVE' })
      .expect(204);
    expect(await items(marie, list.id as string)).toEqual([]);
    expect(await items(tonton, list.id as string)).toEqual([]);
    await http()
      .get(`/api/v1/items/${item.id as string}`)
      .set({ Cookie: tonton.cookie })
      .expect(404);
  });
});

describe('Audience et refus (VIS-01, VIS-03, VIS-34)', () => {
  it('hors du cercle : la liste et ses éléments répondent comme des identifiants inconnus', async () => {
    const marie = await person();
    const stranger = await person();
    const list = await personalList(marie);
    const item = await addItem(marie, list.id as string);
    const theirs = await http()
      .get(`/api/v1/lists/${list.id as string}`)
      .set({ Cookie: stranger.cookie });
    const unknown = await http()
      .get(`/api/v1/lists/${randomUUID()}`)
      .set({ Cookie: stranger.cookie });
    expect({ status: theirs.status, code: theirs.body.code }).toEqual({
      status: unknown.status,
      code: unknown.body.code,
    });
    expect(theirs.status).toBe(404);
    await http()
      .get(`/api/v1/items/${item.id as string}`)
      .set({ Cookie: stranger.cookie })
      .expect(404);
    await http()
      .get(`/api/v1/lists/${list.id as string}/items`)
      .set({ Cookie: stranger.cookie })
      .expect(404);
    const all = await http().get('/api/v1/lists').set({ Cookie: stranger.cookie }).expect(200);
    expect((all.body.items as Body[]).map((l) => l.id)).not.toContain(list.id);
  });

  it('LNK-02 : lien rompu, accès retiré à la requête suivante', async () => {
    const marie = await person();
    const tonton = await person();
    await link(marie, tonton);
    const list = await personalList(marie);
    await http()
      .get(`/api/v1/lists/${list.id as string}`)
      .set({ Cookie: tonton.cookie })
      .expect(200);
    identity.links.links.clear();
    await http()
      .get(`/api/v1/lists/${list.id as string}`)
      .set({ Cookie: tonton.cookie })
      .expect(404);
  });

  it('VIS-01 : audience MEMBRES ou sélection explicite', async () => {
    const marie = await person();
    const tonton = await person();
    const mamie = await person();
    await link(marie, tonton);
    await link(marie, mamie);
    const res = await http()
      .post('/api/v1/lists')
      .set(marie.mutation)
      .send({
        type: 'WISHLIST',
        title: 'Anniversaire',
        audience: 'CUSTOM',
        customAudience: [mamie.profileId],
      })
      .expect(201);
    const id = res.body.id as string;
    await http().get(`/api/v1/lists/${id}`).set({ Cookie: mamie.cookie }).expect(200);
    await http().get(`/api/v1/lists/${id}`).set({ Cookie: tonton.cookie }).expect(404);
    // Hors du cercle : refusé dans la sélection.
    const stranger = await person();
    await http()
      .post('/api/v1/lists')
      .set(marie.mutation)
      .send({
        type: 'WISHLIST',
        title: 'x',
        audience: 'CUSTOM',
        customAudience: [stranger.profileId],
      })
      .expect(422);
  });

  it('LST-07 : wishlist pour un profil de son compte oui ; pour un autre compte non', async () => {
    const parent = await person();
    const kid = await sibling(parent, true);
    const friend = await person();
    await link(parent, friend);
    const ok = await http()
      .post('/api/v1/lists')
      .set(parent.mutation)
      .send({ type: 'WISHLIST', title: 'Noël de Léo', recipientIds: [kid.profileId] })
      .expect(201);
    // Le parent, créateur non destinataire, est offreur ; l'enfant, destinataire contributeur.
    expect(ok.body).toMatchObject({ view: 'giver', myRole: 'CREATOR' });
    const kidView = await http()
      .get(`/api/v1/lists/${ok.body.id as string}`)
      .set({ Cookie: kid.cookie });
    expect(kidView.body).toMatchObject({ view: 'recipient', myRole: 'CONTRIBUTOR' });
    const refused = await http()
      .post('/api/v1/lists')
      .set(parent.mutation)
      .send({ type: 'WISHLIST', title: 'x', recipientIds: [friend.profileId] });
    expect({ status: refused.status, code: refused.body.code }).toEqual({
      status: 422,
      code: 'RECIPIENT_NOT_ALLOWED',
    });
  });
});

describe('Giftlist (GFT-01 à GFT-10)', () => {
  it('GFT-07 : cachée, le destinataire ne voit rien, nulle part', async () => {
    const papa = await person();
    const marie = await person();
    await link(papa, marie);
    const before = await http().get('/api/v1/lists').set({ Cookie: marie.cookie }).expect(200);
    const gift = await createGiftlist(papa, [marie.profileId!]);
    const item = await addItem(papa, gift.id as string);
    const after = await http().get('/api/v1/lists').set({ Cookie: marie.cookie }).expect(200);
    expect(after.body).toEqual(before.body);
    const direct = await http()
      .get(`/api/v1/lists/${gift.id as string}`)
      .set({ Cookie: marie.cookie });
    const unknown = await http().get(`/api/v1/lists/${randomUUID()}`).set({ Cookie: marie.cookie });
    const { requestId: _a, ...directBody } = direct.body as Body;
    const { requestId: _b, ...unknownBody } = unknown.body as Body;
    expect({ status: direct.status, ...directBody }).toEqual({
      status: unknown.status,
      ...unknownBody,
    });
    await http()
      .get(`/api/v1/items/${item.id as string}`)
      .set({ Cookie: marie.cookie })
      .expect(404);
  });

  it('GFT-03, GFT-09 : révélée, l’existence seule ; contenu montré, les éléments en vue destinataire', async () => {
    const papa = await person();
    const marie = await person();
    await link(papa, marie);
    const gift = await createGiftlist(papa, [marie.profileId!], { giftExistence: 'REVEALED' });
    const shown = await addItem(papa, gift.id as string, { shownToRecipient: true });
    await addItem(papa, gift.id as string);
    const teaser = await http()
      .get(`/api/v1/lists/${gift.id as string}`)
      .set({ Cookie: marie.cookie })
      .expect(200);
    expect(teaser.body).toEqual({ view: 'teaser', id: gift.id, content: 'NONE' });
    expect(await items(marie, gift.id as string)).toEqual([]);
    await http()
      .get(`/api/v1/lists/${gift.id as string}/members`)
      .set({ Cookie: marie.cookie })
      .expect(404);

    const partial = await http()
      .patch(`/api/v1/lists/${gift.id as string}`)
      .set({ ...papa.mutation, 'If-Match': String(gift.version) })
      .send({ giftContent: 'PARTIAL' })
      .expect(200);
    const seen = await items(marie, gift.id as string);
    expect(seen.map((i) => i.id)).toEqual([shown.id]);
    expect(seen[0]).toMatchObject({ view: 'recipient' });
    for (const field of RESERVATION_FIELDS) expect(seen[0]).not.toHaveProperty(field);

    await http()
      .patch(`/api/v1/lists/${gift.id as string}`)
      .set({ ...papa.mutation, 'If-Match': String(partial.body.version) })
      .send({ giftContent: 'FULL' })
      .expect(200);
    expect(await items(marie, gift.id as string)).toHaveLength(2);
  });

  it('GFT-04 : contenu montré sans existence révélée refusé', async () => {
    const papa = await person();
    const marie = await person();
    await link(papa, marie);
    const res = await http()
      .post('/api/v1/lists')
      .set(papa.mutation)
      .send({ type: 'GIFTLIST', title: 'x', recipientIds: [marie.profileId], giftContent: 'FULL' });
    expect(res.body.code).toBe('GIFT_SETTINGS_INCONSISTENT');
  });

  it('GFT-01, GFT-06, LST-08 : destinataire jamais membre ; membres pris dans le cercle', async () => {
    const papa = await person();
    const marie = await person();
    const tonton = await person();
    const stranger = await person();
    await link(papa, marie);
    await link(papa, tonton);
    const gift = await createGiftlist(papa, [marie.profileId!]);
    const id = gift.id as string;
    const asMember = await http()
      .put(`/api/v1/lists/${id}/members/${marie.profileId!}`)
      .set(papa.mutation)
      .send({ role: 'READER' });
    expect(asMember.body.code).toBe('MEMBER_NOT_ALLOWED');
    const outsider = await http()
      .put(`/api/v1/lists/${id}/members/${stranger.profileId!}`)
      .set(papa.mutation)
      .send({ role: 'READER' });
    expect(outsider.body.code).toBe('MEMBER_NOT_ALLOWED');
    await http()
      .put(`/api/v1/lists/${id}/members/${tonton.profileId!}`)
      .set(papa.mutation)
      .send({ role: 'READER' })
      .expect(204);
    // LST-02 : un lecteur voit mais n'ajoute pas ; un contributeur ajoute.
    expect(await items(tonton, id)).toEqual([]);
    await http()
      .post(`/api/v1/lists/${id}/items`)
      .set(tonton.mutation)
      .send({ productId: await product(tonton) })
      .expect(403);
    await http()
      .put(`/api/v1/lists/${id}/members/${tonton.profileId!}`)
      .set(papa.mutation)
      .send({ role: 'CONTRIBUTOR' })
      .expect(204);
    await addItem(tonton, id);
    // GFT-01 : un destinataire de giftlist n'est pas destinataire de sa propre liste en membre.
    const self = await http()
      .post('/api/v1/lists')
      .set(papa.mutation)
      .send({ type: 'GIFTLIST', title: 'x', recipientIds: [papa.profileId] });
    expect(self.body.code).toBe('RECIPIENT_NOT_ALLOWED');
  });
});

describe('Succession et corbeille (LST-04, LST-09, LST-20)', () => {
  it('le créateur désigne un responsable pour partir ; celui-ci devient l’autorité', async () => {
    const papa = await person();
    const tonton = await person();
    const marie = await person();
    await link(papa, tonton);
    await link(papa, marie);
    const gift = await createGiftlist(papa, [marie.profileId!]);
    const id = gift.id as string;
    await http()
      .put(`/api/v1/lists/${id}/members/${tonton.profileId!}`)
      .set(papa.mutation)
      .send({ role: 'CONTRIBUTOR' })
      .expect(204);
    const refused = await http().post(`/api/v1/lists/${id}/leave`).set(papa.mutation).send({});
    expect(refused.body.code).toBe('SUCCESSOR_REQUIRED');
    await http()
      .post(`/api/v1/lists/${id}/leave`)
      .set(papa.mutation)
      .send({ successorProfileId: tonton.profileId })
      .expect(204);
    await http().get(`/api/v1/lists/${id}`).set({ Cookie: papa.cookie }).expect(404);
    const now = await http().get(`/api/v1/lists/${id}`).set({ Cookie: tonton.cookie }).expect(200);
    expect(now.body).toMatchObject({
      myRole: 'OWNER',
      permissions: { delete: true, editRules: true },
    });
  });

  it('supprimée : invisible des autres, dans la corbeille de l’autorité, restaurable', async () => {
    const papa = await person();
    const tonton = await person();
    const marie = await person();
    await link(papa, tonton);
    await link(papa, marie);
    const gift = await createGiftlist(papa, [marie.profileId!]);
    const id = gift.id as string;
    await http()
      .put(`/api/v1/lists/${id}/members/${tonton.profileId!}`)
      .set(papa.mutation)
      .send({ role: 'OWNER' })
      .expect(204);
    // LST-02 : le responsable ne supprime pas tant que le créateur est là.
    await http().delete(`/api/v1/lists/${id}`).set(tonton.mutation).expect(403);
    await http().delete(`/api/v1/lists/${id}`).set(papa.mutation).expect(204);
    await http().get(`/api/v1/lists/${id}`).set({ Cookie: tonton.cookie }).expect(404);
    const trash = await http()
      .get('/api/v1/lists?scope=trash')
      .set({ Cookie: papa.cookie })
      .expect(200);
    expect((trash.body.items as Body[]).map((l) => l.id)).toEqual([id]);
    await http().post(`/api/v1/lists/${id}/restore`).set(papa.mutation).expect(200);
    await http().get(`/api/v1/lists/${id}`).set({ Cookie: tonton.cookie }).expect(200);
  });
});

describe('Éléments (ART-03, ART-04, ART-05, ART-10, API-17)', () => {
  it('prix copié de la fiche ; modifié sur l’élément avec If-Match ; version dépassée : 412', async () => {
    const marie = await person();
    const list = await personalList(marie);
    const productId = await product(marie, 'Livre', 1999);
    const created = await http()
      .post(`/api/v1/lists/${list.id as string}/items`)
      .set(marie.mutation)
      .send({ productId, quantity: 3 })
      .expect(201);
    expect(created.body).toMatchObject({ unitPriceMinor: 1999, quantity: 3, currency: 'EUR' });
    // ART-06 : la fiche change de prix, l'élément non.
    await http()
      .patch(`/api/v1/products/${productId}`)
      .set({ ...marie.mutation, 'If-Match': '1' })
      .send({ unitPriceMinor: 2999 })
      .expect(200);
    expect((await items(marie, list.id as string))[0]).toMatchObject({ unitPriceMinor: 1999 });
    const itemId = created.body.id as string;
    await http()
      .patch(`/api/v1/items/${itemId}`)
      .set({ ...marie.mutation, 'If-Match': '1' })
      .send({ unitPriceMinor: 2499, priority: 'MUST' })
      .expect(200);
    await http()
      .patch(`/api/v1/items/${itemId}`)
      .set({ ...marie.mutation, 'If-Match': '1' })
      .send({ note: 'taille M' })
      .expect(412);
  });

  it('ART-05 : la fiche d’un autre profil ne s’ajoute pas ; ART-04 : elle se copie depuis l’élément', async () => {
    const marie = await person();
    const tonton = await person();
    await link(marie, tonton);
    const list = await personalList(marie);
    const item = await addItem(marie, list.id as string);
    const tontonList = await personalList(tonton);
    const theirs = await http()
      .post(`/api/v1/lists/${tontonList.id as string}/items`)
      .set(tonton.mutation)
      .send({ productId: (item.product as Body).id });
    expect(theirs.body.code).toBe('PRODUCT_NOT_FOUND');
    const copy = await http()
      .post(`/api/v1/items/${item.id as string}/copy`)
      .set(tonton.mutation)
      .expect(201);
    const productId = copy.body.productId as string;
    expect(catalog.products.rows.get(productId)?.ownerProfileId).toBe(tonton.profileId);
    await http()
      .post(`/api/v1/lists/${tontonList.id as string}/items`)
      .set(tonton.mutation)
      .send({ productId })
      .expect(201);
    // Un profil qui ne voit pas l'élément ne le copie pas.
    const stranger = await person();
    await http()
      .post(`/api/v1/items/${item.id as string}/copy`)
      .set(stranger.mutation)
      .expect(404);
  });

  it('LST-06 : tri par priorité et par prix', async () => {
    const marie = await person();
    const list = await personalList(marie);
    const id = list.id as string;
    const a = await addItem(marie, id, { priority: 'WANT', unitPriceMinor: 500 });
    const b = await addItem(marie, id, { priority: 'MUST', unitPriceMinor: 100 });
    const byPriority = await http()
      .get(`/api/v1/lists/${id}/items?sort=priority`)
      .set({ Cookie: marie.cookie });
    expect((byPriority.body.items as Body[]).map((i) => i.id)).toEqual([b.id, a.id]);
    const byPrice = await http()
      .get(`/api/v1/lists/${id}/items?sort=price`)
      .set({ Cookie: marie.cookie });
    expect((byPrice.body.items as Body[]).map((i) => i.id)).toEqual([b.id, a.id]);
  });
});
