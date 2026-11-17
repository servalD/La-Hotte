import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import { createTestApp, type TestCatalog, type TestIdentity } from './create-test-app';

// Règles de visibilité par élément et journal (VIS-10 à VIS-19, LST-03, critères de 03 et 04).

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
  identity.accounts.seed({ id: user.accountId, email: `v-${user.accountId}@lahotte.test` });
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

async function addItem(user: SignedIn, listId: string): Promise<Body> {
  const productRes = await http()
    .post('/api/v1/products')
    .set(user.mutation)
    .send({ title: 'Fiche' })
    .expect(201);
  const res = await http()
    .post(`/api/v1/lists/${listId}/items`)
    .set(user.mutation)
    .send({ productId: productRes.body.id })
    .expect(201);
  return res.body as Body;
}

async function seen(user: SignedIn, listId: string): Promise<string[]> {
  const res = await http().get(`/api/v1/lists/${listId}/items`).set({ Cookie: user.cookie });
  return ((res.body.items as Body[] | undefined) ?? []).map((i) => i.id as string);
}

function setRule(
  user: SignedIn,
  item: Body,
  mode: string,
  profileIds: (string | null)[],
  version?: number,
) {
  return http()
    .put(`/api/v1/items/${item.id as string}/visibility`)
    .set({ ...user.mutation, 'If-Match': String(version ?? item.version) })
    .send({ mode, profileIds });
}

/** Giftlist pour Marie, créée par Papa ; Tonton et Mamie dans son cercle. */
async function world() {
  const papa = await person();
  const marie = await person();
  const tonton = await person();
  const mamie = await person();
  for (const other of [marie, tonton, mamie]) await link(papa, other);
  // VIS-19 : Tonton choisit Mamie dans son propre cercle.
  await link(tonton, mamie);
  const res = await http()
    .post('/api/v1/lists')
    .set(papa.mutation)
    .send({ type: 'GIFTLIST', title: 'Pour Marie', recipientIds: [marie.profileId] })
    .expect(201);
  return { papa, marie, tonton, mamie, list: res.body as Body };
}

async function addMember(by: SignedIn, list: Body, who: SignedIn, role: string): Promise<void> {
  await http()
    .put(`/api/v1/lists/${list.id as string}/members/${who.profileId!}`)
    .set(by.mutation)
    .send({ role })
    .expect(204);
}

describe('Règle d’un élément (VIS-10, VIS-11, VIS-15)', () => {
  it('TOUS SAUF écarte le profil ; SEULEMENT ne garde que les choisis ; l’élément est dit caché', async () => {
    const { papa, tonton, mamie, list } = await world();
    const id = list.id as string;
    await addMember(papa, list, tonton, 'READER');
    await addMember(papa, list, mamie, 'READER');
    const item = await addItem(papa, id);
    const except = await setRule(papa, item, 'EXCEPT', [tonton.profileId]).expect(200);
    expect(except.body).toMatchObject({ mode: 'EXCEPT', profiles: [tonton.profileId], version: 2 });
    expect(await seen(tonton, id)).toEqual([]);
    expect(await seen(mamie, id)).toEqual([item.id]);
    const giverView = await http()
      .get(`/api/v1/items/${item.id as string}`)
      .set({ Cookie: mamie.cookie });
    expect(giverView.body).toMatchObject({ hidden: true, visibilityMode: 'EXCEPT' });

    await setRule(papa, item, 'ONLY', [tonton.profileId], 2).expect(200);
    expect(await seen(tonton, id)).toEqual([item.id]);
    expect(await seen(mamie, id)).toEqual([]);
  });

  it('critère de 04 (VIS-15) : arrivé dans l’audience après coup, on voit TOUS SAUF, pas SEULEMENT', async () => {
    const { papa, tonton, mamie, list } = await world();
    const id = list.id as string;
    await addMember(papa, list, tonton, 'READER');
    const except = await addItem(papa, id);
    const only = await addItem(papa, id);
    await setRule(papa, except, 'EXCEPT', [tonton.profileId]).expect(200);
    await setRule(papa, only, 'ONLY', [tonton.profileId]).expect(200);
    await addMember(papa, list, mamie, 'READER');
    expect(await seen(mamie, id)).toEqual([except.id]);
  });

  it('VIS-12 : un profil choisi hors de l’audience est signalé', async () => {
    const { papa, tonton, list } = await world();
    const item = await addItem(papa, list.id as string);
    const res = await setRule(papa, item, 'ONLY', [tonton.profileId]).expect(200);
    expect(res.body.outsideAudience).toEqual([tonton.profileId]);
  });

  it('VIS-19 : un profil hors du cercle et des membres est refusé', async () => {
    const { papa, list } = await world();
    const stranger = await person();
    const item = await addItem(papa, list.id as string);
    const res = await setRule(papa, item, 'EXCEPT', [stranger.profileId]);
    expect({ status: res.status, code: res.body.code }).toEqual({
      status: 422,
      code: 'VISIBILITY_PROFILE_INVALID',
    });
  });

  it('VIS-16 : on n’écarte pas un profil engagé sur l’élément', async () => {
    const { papa, tonton, list } = await world();
    await addMember(papa, list, tonton, 'READER');
    const item = await addItem(papa, list.id as string);
    catalog.engagements.engaged.set(item.id as string, [tonton.profileId!]);
    const res = await setRule(papa, item, 'EXCEPT', [tonton.profileId]);
    expect(res.body.code).toBe('VISIBILITY_ENGAGED_PROFILE');
    catalog.engagements.engaged.clear();
  });

  it('VIS-37 : la destinataire écarte un offreur engagé comme sur un souhait libre (VIS-20)', async () => {
    const { papa, marie } = await world();
    const lists = await http().get('/api/v1/lists').set({ Cookie: marie.cookie });
    const own = (lists.body.items as Body[]).find((l) => l.personal)!;
    const free = await addItem(marie, own.id as string);
    const engaged = await addItem(marie, own.id as string);
    catalog.engagements.engaged.set(engaged.id as string, [papa.profileId!]);
    const a = await setRule(marie, free, 'EXCEPT', [papa.profileId]);
    const b = await setRule(marie, engaged, 'EXCEPT', [papa.profileId]);
    catalog.engagements.engaged.clear();
    expect(b.status).toBe(a.status);
    expect(b.status).toBe(200);
    expect(Object.keys(b.body as Body).sort()).toEqual(Object.keys(a.body as Body).sort());
  });

  it('API-17 : version dépassée, 412', async () => {
    const { papa, tonton, list } = await world();
    const item = await addItem(papa, list.id as string);
    await setRule(papa, item, 'EXCEPT', [tonton.profileId]).expect(200);
    await setRule(papa, item, 'ALL', [], 1).expect(412);
  });
});

describe('Qui modifie la règle (LST-03, VIS-18, critères de 03)', () => {
  it('un contributeur non autorisé reçoit 403, et ne lit pas la règle', async () => {
    const { papa, tonton, mamie, list } = await world();
    await addMember(papa, list, tonton, 'CONTRIBUTOR');
    const mine = await addItem(tonton, list.id as string);
    const res = await setRule(tonton, mine, 'EXCEPT', [mamie.profileId]);
    expect({ status: res.status, code: res.body.code }).toEqual({
      status: 403,
      code: 'VISIBILITY_EDIT_FORBIDDEN',
    });
    await http()
      .get(`/api/v1/items/${mine.id as string}/visibility`)
      .set({ Cookie: tonton.cookie })
      .expect(403);
  });

  it('délégué au contributeur : ses propres éléments seulement', async () => {
    const { papa, tonton, mamie, list } = await world();
    await addMember(papa, list, tonton, 'CONTRIBUTOR');
    await http()
      .patch(`/api/v1/lists/${list.id as string}`)
      .set({ ...papa.mutation, 'If-Match': String(list.version) })
      .send({ visibilityEditRole: 'CONTRIBUTOR' })
      .expect(200);
    const mine = await addItem(tonton, list.id as string);
    const papas = await addItem(papa, list.id as string);
    await setRule(tonton, mine, 'EXCEPT', [mamie.profileId]).expect(200);
    await setRule(tonton, papas, 'EXCEPT', [mamie.profileId]).expect(403);
    // Seule l'autorité délègue.
    const latest = await http()
      .get(`/api/v1/lists/${list.id as string}`)
      .set({ Cookie: tonton.cookie });
    await http()
      .patch(`/api/v1/lists/${list.id as string}`)
      .set({ ...tonton.mutation, 'If-Match': String(latest.body.version) })
      .send({ visibilityEditRole: 'OWNER' })
      .expect(403);
  });

  it('après le retrait du créateur, le responsable désigné modifie les règles', async () => {
    const { papa, tonton, mamie, list } = await world();
    await addMember(papa, list, tonton, 'CONTRIBUTOR');
    const item = await addItem(papa, list.id as string);
    await http()
      .post(`/api/v1/lists/${list.id as string}/leave`)
      .set(papa.mutation)
      .send({ successorProfileId: tonton.profileId })
      .expect(204);
    await setRule(tonton, item, 'EXCEPT', [mamie.profileId]).expect(200);
  });
});

describe('Journal (VIS-14, VIS-19)', () => {
  it('qui, quand, avant, après ; règle par défaut comprise ; lu par l’autorité seule', async () => {
    const { papa, tonton, mamie, list } = await world();
    await addMember(papa, list, tonton, 'OWNER');
    const item = await addItem(papa, list.id as string);
    await setRule(papa, item, 'EXCEPT', [mamie.profileId]).expect(200);
    const patched = await http()
      .patch(`/api/v1/lists/${list.id as string}`)
      .set({ ...papa.mutation, 'If-Match': String(list.version) })
      .send({ defaultItemVisibility: 'ONLY' })
      .expect(200);
    expect(patched.body.defaultItemVisibility).toBe('ONLY');
    // Les éléments nouveaux prennent la règle par défaut (LST-01).
    const next = await addItem(papa, list.id as string);
    expect(next).toMatchObject({ visibilityMode: 'ONLY', hidden: true });

    const log = await http()
      .get(`/api/v1/lists/${list.id as string}/visibility-log`)
      .set({ Cookie: papa.cookie })
      .expect(200);
    expect(log.body.items).toHaveLength(2);
    expect(log.body.items[0]).toMatchObject({
      itemId: null,
      changedBy: papa.profileId,
      before: { mode: 'ALL', profiles: [] },
      after: { mode: 'ONLY', profiles: [] },
    });
    expect(log.body.items[1]).toMatchObject({
      itemId: item.id,
      before: { mode: 'ALL', profiles: [] },
      after: { mode: 'EXCEPT', profiles: [mamie.profileId] },
    });
    await http()
      .get(`/api/v1/lists/${list.id as string}/visibility-log`)
      .set({ Cookie: tonton.cookie })
      .expect(403);
  });

  it('la règle d’une suggestion n’est pas au journal, que lit le destinataire autorité', async () => {
    const marie = await person();
    const tonton = await person();
    const mamie = await person();
    await link(marie, tonton);
    await link(marie, mamie);
    await link(tonton, mamie);
    const all = await http().get('/api/v1/lists').set({ Cookie: marie.cookie }).expect(200);
    const listId = (all.body.items as Body[]).find((l) => l.personal)!.id as string;
    const suggestion = await addItem(tonton, listId);
    await setRule(tonton, suggestion, 'EXCEPT', [mamie.profileId]).expect(200);
    const log = await http()
      .get(`/api/v1/lists/${listId}/visibility-log`)
      .set({ Cookie: marie.cookie })
      .expect(200);
    expect(log.body.items).toEqual([]);
  });
});
