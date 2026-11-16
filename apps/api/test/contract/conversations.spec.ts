import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import { createTestApp, type TestConversations, type TestIdentity } from './create-test-app';

// Fils d'un élément (06, COM-01 à COM-17, NOT-13), API montée, ports en mémoire.

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

async function link(x: SignedIn, y: SignedIn): Promise<void> {
  const invitation = await http().post('/api/v1/invitations').set(x.mutation).send({}).expect(201);
  await http()
    .post('/api/v1/invitations/redeem')
    .set(y.mutation)
    .send({ token: invitation.body.token as string })
    .expect(201);
}

async function person(): Promise<SignedIn> {
  const user = await identity.signIn();
  identity.accounts.seed({ id: user.accountId, email: `p-${user.accountId}@lahotte.test` });
  return user;
}

async function product(user: SignedIn): Promise<string> {
  const res = await http()
    .post('/api/v1/products')
    .set(user.mutation)
    .send({ title: 'Vélo', unitPriceMinor: 4900, currency: 'EUR' })
    .expect(201);
  return res.body.id as string;
}

async function addItem(user: SignedIn, listId: string, body: Body = {}): Promise<string> {
  const res = await http()
    .post(`/api/v1/lists/${listId}/items`)
    .set(user.mutation)
    .send({ productId: await product(user), ...body })
    .expect(201);
  return res.body.id as string;
}

/** Léa tient sa wishlist (audience cercle) ; Paul est de son cercle. */
async function wishlistWorld() {
  const lea = await person();
  const paul = await person();
  const outsider = await person();
  await link(lea, paul);
  const list = await http()
    .post('/api/v1/lists')
    .set(lea.mutation)
    .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [lea.profileId] })
    .expect(201);
  const listId = list.body.id as string;
  const itemId = await addItem(lea, listId);
  return { lea, paul, outsider, listId, itemId };
}

function post(user: SignedIn, itemId: string, thread: string, body: Body = {}) {
  return http()
    .post(`/api/v1/items/${itemId}/comments`)
    .set(user.mutation)
    .send({ thread, body: 'Quelle taille ?', ...body });
}

describe('COM-01, COM-03, COM-11 : deux fils, l’Offreurs n’existe pas pour le destinataire', () => {
  it('le destinataire lit le Public, jamais l’Offreurs, et n’en a ni onglet ni compteur', async () => {
    const { lea, paul, itemId } = await wishlistWorld();
    await post(paul, itemId, 'GIVERS', { body: 'Je prends, qui partage ?' }).expect(201);
    await post(paul, itemId, 'PUBLIC', { body: 'Plutôt en bleu ?' }).expect(201);

    const leaThreads = await http()
      .get(`/api/v1/items/${itemId}/threads`)
      .set({ Cookie: lea.cookie })
      .expect(200);
    expect(leaThreads.body).toEqual({
      view: 'recipient',
      public: { count: 1, canWrite: true },
      following: true,
    });
    const refused = await http()
      .get(`/api/v1/items/${itemId}/comments?thread=GIVERS`)
      .set({ Cookie: lea.cookie })
      .expect(404);
    expect(refused.body.code).toBe('ITEM_NOT_FOUND');
    await post(lea, itemId, 'GIVERS').expect(404);
    const pub = await http()
      .get(`/api/v1/items/${itemId}/comments?thread=PUBLIC`)
      .set({ Cookie: lea.cookie })
      .expect(200);
    expect((pub.body.items as Body[]).map((c) => c.body)).toEqual(['Plutôt en bleu ?']);
    expect(JSON.stringify(pub.body)).not.toContain('partage');

    const paulThreads = await http()
      .get(`/api/v1/items/${itemId}/threads`)
      .set({ Cookie: paul.cookie })
      .expect(200);
    expect(paulThreads.body).toMatchObject({
      view: 'giver',
      public: { count: 1, canWrite: true },
      givers: { count: 1, canWrite: true },
    });
  });

  it('VIS-34 : hors de l’audience, tout répond comme un élément inconnu', async () => {
    const { outsider, itemId } = await wishlistWorld();
    for (const path of [
      `/api/v1/items/${itemId}/threads`,
      `/api/v1/items/${itemId}/comments?thread=PUBLIC`,
      `/api/v1/items/${randomUUID()}/threads`,
    ]) {
      const res = await http().get(path).set({ Cookie: outsider.cookie }).expect(404);
      expect(res.body.code).toBe('ITEM_NOT_FOUND');
    }
    await post(outsider, itemId, 'PUBLIC').expect(404);
  });
});

describe('COM-12 : fil Public fermé quand aucun destinataire ne voit l’élément', () => {
  it('une suggestion n’a que le fil Offreurs', async () => {
    const { lea, paul, listId } = await wishlistWorld();
    const suggestion = await addItem(paul, listId, { isSuggestion: true });
    const threads = await http()
      .get(`/api/v1/items/${suggestion}/threads`)
      .set({ Cookie: paul.cookie })
      .expect(200);
    expect(threads.body).toMatchObject({ view: 'giver', public: null });
    await post(paul, suggestion, 'PUBLIC').expect(404);
    await post(paul, suggestion, 'GIVERS').expect(201);
    await http().get(`/api/v1/items/${suggestion}/threads`).set({ Cookie: lea.cookie }).expect(404);
  });

  it('giftlist cachée : fil Offreurs seul ; contenu montré : le Public s’ouvre', async () => {
    const org = await person();
    const lea = await person();
    await link(org, lea);
    const gift = await http()
      .post('/api/v1/lists')
      .set(org.mutation)
      .send({ type: 'GIFTLIST', title: 'Pour Léa', recipientIds: [lea.profileId] })
      .expect(201);
    const listId = gift.body.id as string;
    const itemId = await addItem(org, listId);
    await post(org, itemId, 'PUBLIC').expect(404);
    await post(org, itemId, 'GIVERS', { body: 'Commandé' }).expect(201);
    await http().get(`/api/v1/items/${itemId}/threads`).set({ Cookie: lea.cookie }).expect(404);

    const list = await http().get(`/api/v1/lists/${listId}`).set({ Cookie: org.cookie });
    await http()
      .patch(`/api/v1/lists/${listId}`)
      .set({ ...org.mutation, 'If-Match': String(list.body.version) })
      .send({ giftExistence: 'REVEALED', giftContent: 'FULL' })
      .expect(200);
    await post(org, itemId, 'PUBLIC', { body: 'Bon anniversaire !' }).expect(201);
    const seen = await http()
      .get(`/api/v1/items/${itemId}/comments?thread=PUBLIC`)
      .set({ Cookie: lea.cookie })
      .expect(200);
    expect((seen.body.items as Body[]).map((c) => c.body)).toEqual(['Bon anniversaire !']);
    await http()
      .get(`/api/v1/items/${itemId}/comments?thread=GIVERS`)
      .set({ Cookie: lea.cookie })
      .expect(404);
  });
});

describe('COM-13 : texte et mentions', () => {
  it('texte vide refusé ; mention hors du cercle de l’auteur ignorée', async () => {
    const { paul, outsider, itemId } = await wishlistWorld();
    const blank = await post(paul, itemId, 'GIVERS', { body: '   ' }).expect(422);
    expect(blank.body.code).toBe('COMMENT_INVALID');
    const res = await post(paul, itemId, 'GIVERS', {
      body: 'Hors cercle',
      mentionIds: [outsider.profileId, randomUUID()],
    }).expect(201);
    expect(res.body.mentions).toEqual([]);
  });

  it('B1 (revue SEC-40) : les mentions ne disent jamais qui lit le fil, par aucune réponse', async () => {
    // Léa, destinataire d'une giftlist révélée, mentionne deux proches : Paul, qui prépare la
    // giftlist, et Marc, qui n'en est pas. POST, PATCH et GET les rendent à l'identique.
    const org = await person();
    const lea = await person();
    const marc = await person();
    await link(org, lea);
    await link(lea, marc);
    const gift = await http()
      .post('/api/v1/lists')
      .set(org.mutation)
      .send({
        type: 'GIFTLIST',
        title: 'Pour Léa',
        recipientIds: [lea.profileId],
        giftExistence: 'REVEALED',
        giftContent: 'FULL',
      })
      .expect(201);
    const itemId = await addItem(org, gift.body.id as string);
    const ids = (r: { body: Body }) => (r.body.mentions as Body[]).map((m) => m.id).sort();
    const both = [org.profileId, marc.profileId].sort();
    const created = await post(lea, itemId, 'PUBLIC', {
      body: 'Coucou',
      mentionIds: [org.profileId, marc.profileId],
    }).expect(201);
    expect(ids(created)).toEqual(both);
    const edited = await http()
      .patch(`/api/v1/comments/${created.body.id as string}`)
      .set(lea.mutation)
      .send({ body: 'Coucou !', mentionIds: [marc.profileId, org.profileId] })
      .expect(200);
    expect(ids(edited)).toEqual(both);
    const listed = await http()
      .get(`/api/v1/items/${itemId}/comments?thread=PUBLIC`)
      .set({ Cookie: lea.cookie })
      .expect(200);
    expect(((listed.body.items as Body[])[0]!.mentions as Body[]).map((m) => m.id).sort()).toEqual(
      both,
    );
    // Seule la notification passe par le moteur : Marc, qui ne voit pas l'élément, n'en a pas.
    await conversations.settle();
    expect(conversations.notifications.forProfile(marc.profileId!)).toEqual([]);
    expect(conversations.notifications.forProfile(org.profileId!).map((n) => n.type)).toContain(
      'comment.mention',
    );
  });
});

describe('COM-15, COM-16 : modification, suppression, réactions', () => {
  it('l’auteur modifie 15 minutes ; un autre ne modifie pas ; l’autorité supprime', async () => {
    const { lea, paul, itemId } = await wishlistWorld();
    const created = await post(paul, itemId, 'PUBLIC').expect(201);
    const id = created.body.id as string;
    await http()
      .patch(`/api/v1/comments/${id}`)
      .set(lea.mutation)
      .send({ body: 'Pirate' })
      .expect(403);
    const edited = await http()
      .patch(`/api/v1/comments/${id}`)
      .set(paul.mutation)
      .send({ body: 'Quelle pointure ?' })
      .expect(200);
    expect(edited.body).toMatchObject({ body: 'Quelle pointure ?', editedAt: expect.any(String) });
    const row = conversations.comments.comments.get(id)!;
    conversations.comments.comments.set(id, {
      ...row,
      createdAt: new Date(Date.now() - 16 * 60 * 1000),
    });
    const late = await http()
      .patch(`/api/v1/comments/${id}`)
      .set(paul.mutation)
      .send({ body: 'Trop tard' })
      .expect(422);
    expect(late.body.code).toBe('COMMENT_EDIT_EXPIRED');

    await http().put(`/api/v1/comments/${id}/reactions/HEART`).set(lea.mutation).expect(204);
    await http().put(`/api/v1/comments/${id}/reactions/HEART`).set(lea.mutation).expect(204);
    await http().put(`/api/v1/comments/${id}/reactions/LIKE`).set(lea.mutation).expect(400);
    const listed = await http()
      .get(`/api/v1/items/${itemId}/comments?thread=PUBLIC`)
      .set({ Cookie: paul.cookie });
    expect((listed.body.items as Body[])[0]!.reactions).toEqual([
      { reaction: 'HEART', count: 1, mine: false },
    ]);

    // Léa est l'autorité de sa liste (COM-15, LST-09).
    await http().delete(`/api/v1/comments/${id}`).set(lea.mutation).expect(204);
    const after = await http()
      .get(`/api/v1/items/${itemId}/comments?thread=PUBLIC`)
      .set({ Cookie: paul.cookie });
    expect((after.body.items as Body[])[0]).toMatchObject({
      deleted: true,
      body: '',
      reactions: [],
      canDelete: false,
    });
    await http().put(`/api/v1/comments/${id}/reactions/HEART`).set(paul.mutation).expect(403);
  });

  it('VIS-34 : un message du fil Offreurs répond 404 au destinataire, quelle que soit la route', async () => {
    const { lea, paul, itemId } = await wishlistWorld();
    const secret = await post(paul, itemId, 'GIVERS').expect(201);
    const id = secret.body.id as string;
    for (const call of [
      http().patch(`/api/v1/comments/${id}`).set(lea.mutation).send({ body: 'x' }),
      http().delete(`/api/v1/comments/${id}`).set(lea.mutation),
      http().put(`/api/v1/comments/${id}/reactions/HEART`).set(lea.mutation),
    ]) {
      const res = await call.expect(404);
      expect(res.body.code).toBe('COMMENT_NOT_FOUND');
    }
    const unknown = await http()
      .delete(`/api/v1/comments/${randomUUID()}`)
      .set(lea.mutation)
      .expect(404);
    expect(unknown.body).toEqual({ ...unknown.body, code: 'COMMENT_NOT_FOUND' });
  });

  it('COM-11 : liste archivée : on lit, on n’écrit plus', async () => {
    const { lea, paul, listId, itemId } = await wishlistWorld();
    await post(paul, itemId, 'PUBLIC').expect(201);
    const list = await http().get(`/api/v1/lists/${listId}`).set({ Cookie: lea.cookie });
    await http()
      .patch(`/api/v1/lists/${listId}`)
      .set({ ...lea.mutation, 'If-Match': String(list.body.version) })
      .send({ archived: true })
      .expect(200);
    await http()
      .get(`/api/v1/items/${itemId}/comments?thread=PUBLIC`)
      .set({ Cookie: paul.cookie })
      .expect(200);
    await post(paul, itemId, 'PUBLIC').expect(403);
  });
});

describe('COM-14 : activité ; NOT-13 : suivi', () => {
  it('prix changé par le destinataire : activité au fil Public ; suivi d’office du créateur', async () => {
    const { lea, paul, itemId } = await wishlistWorld();
    await conversations.settle();
    expect(await conversations.follows.isFollowing(itemId, lea.profileId!)).toBe(true);
    const item = await http().get(`/api/v1/items/${itemId}`).set({ Cookie: lea.cookie });
    await http()
      .patch(`/api/v1/items/${itemId}`)
      .set({ ...lea.mutation, 'If-Match': String(item.body.version) })
      .send({ unitPriceMinor: 3900 })
      .expect(200);
    await conversations.settle();
    const pub = await http()
      .get(`/api/v1/items/${itemId}/comments?thread=PUBLIC`)
      .set({ Cookie: paul.cookie })
      .expect(200);
    expect((pub.body.items as Body[])[0]).toMatchObject({
      kind: 'ACTIVITY',
      body: '',
      activity: { code: 'PRICE_CHANGED', beforeMinor: 4900, afterMinor: 3900, currency: 'EUR' },
    });
  });

  it('suivi : se désabonner tient malgré un message ; un invisible ne suit pas', async () => {
    const { paul, outsider, itemId } = await wishlistWorld();
    await http().delete(`/api/v1/items/${itemId}/follow`).set(paul.mutation).expect(204);
    await post(paul, itemId, 'GIVERS').expect(201);
    expect(await conversations.follows.isFollowing(itemId, paul.profileId!)).toBe(false);
    await http().put(`/api/v1/items/${itemId}/follow`).set(paul.mutation).expect(204);
    expect(await conversations.follows.isFollowing(itemId, paul.profileId!)).toBe(true);
    await http().put(`/api/v1/items/${itemId}/follow`).set(outsider.mutation).expect(404);
  });

  it('COM-17 : pages du plus récent au plus ancien, curseur', async () => {
    const { paul, itemId } = await wishlistWorld();
    for (let i = 0; i < 3; i += 1) {
      await post(paul, itemId, 'GIVERS', { body: `m${i}` }).expect(201);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const first = await http()
      .get(`/api/v1/items/${itemId}/comments?thread=GIVERS&limit=2`)
      .set({ Cookie: paul.cookie })
      .expect(200);
    expect((first.body.items as Body[]).map((c) => c.body)).toEqual(['m2', 'm1']);
    const next = await http()
      .get(
        `/api/v1/items/${itemId}/comments?thread=GIVERS&limit=2&cursor=${first.body.nextCursor as string}`,
      )
      .set({ Cookie: paul.cookie })
      .expect(200);
    expect((next.body.items as Body[]).map((c) => c.body)).toEqual(['m0']);
    expect(next.body.nextCursor).toBeNull();
  });
});
