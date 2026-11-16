import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import { createTestApp, type TestConversations, type TestIdentity } from './create-test-app';
import { PHASE4_IDOR_ROUTES } from './idor-routes';

// Tests transverses de la phase 4 (tranche 8) : IDOR sur toutes les routes à identifiant des
// échanges (SEC-03, VIS-34, COM-11) ; le destinataire ne peut rien observer de l'activité des
// offreurs, par aucune lecture (VIS-20, VIS-22, NOT-05, critère de sortie de la phase).

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
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

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

async function world() {
  const lea = await person();
  const paul = await person();
  const outsider = await person();
  await link(lea, paul);
  const list = await http()
    .post('/api/v1/lists')
    .set(lea.mutation)
    .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [lea.profileId] })
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
  const comment = await http()
    .post(`/api/v1/items/${itemId}/comments`)
    .set(paul.mutation)
    .send({ thread: 'PUBLIC', body: 'Quelle taille ?' })
    .expect(201);
  await conversations.settle();
  return {
    lea,
    paul,
    outsider,
    listId: list.body.id as string,
    itemId,
    commentId: comment.body.id as string,
  };
}

describe('IDOR des échanges (SEC-03, VIS-34, COM-11)', () => {
  it('chaque route à identifiant : la ressource d’autrui répond comme un identifiant inconnu ; rien ne change', async () => {
    const { outsider, itemId, commentId } = await world();
    const table: {
      route: string;
      method: Method;
      path: (id: string) => string;
      body?: object;
      idOf: 'item' | 'comment';
    }[] = [
      {
        route: 'GET /api/v1/items/:id/threads',
        method: 'get',
        path: (id) => `/api/v1/items/${id}/threads`,
        idOf: 'item',
      },
      {
        route: 'GET /api/v1/items/:id/comments',
        method: 'get',
        path: (id) => `/api/v1/items/${id}/comments?thread=PUBLIC`,
        idOf: 'item',
      },
      {
        route: 'POST /api/v1/items/:id/comments',
        method: 'post',
        path: (id) => `/api/v1/items/${id}/comments`,
        body: { thread: 'PUBLIC', body: 'x' },
        idOf: 'item',
      },
      {
        route: 'PATCH /api/v1/comments/:id',
        method: 'patch',
        path: (id) => `/api/v1/comments/${id}`,
        body: { body: 'x' },
        idOf: 'comment',
      },
      {
        route: 'DELETE /api/v1/comments/:id',
        method: 'delete',
        path: (id) => `/api/v1/comments/${id}`,
        idOf: 'comment',
      },
      {
        route: 'PUT /api/v1/comments/:id/reactions/:reaction',
        method: 'put',
        path: (id) => `/api/v1/comments/${id}/reactions/HEART`,
        idOf: 'comment',
      },
      {
        route: 'DELETE /api/v1/comments/:id/reactions/:reaction',
        method: 'delete',
        path: (id) => `/api/v1/comments/${id}/reactions/HEART`,
        idOf: 'comment',
      },
      {
        route: 'PUT /api/v1/items/:id/follow',
        method: 'put',
        path: (id) => `/api/v1/items/${id}/follow`,
        idOf: 'item',
      },
      {
        route: 'DELETE /api/v1/items/:id/follow',
        method: 'delete',
        path: (id) => `/api/v1/items/${id}/follow`,
        idOf: 'item',
      },
    ];
    const before = JSON.stringify([...conversations.comments.comments.values()]);
    const reactions = conversations.comments.reactions.size;
    const follows = JSON.stringify([...conversations.follows.follows.entries()]);
    for (const row of table) {
      const target = row.idOf === 'item' ? itemId : commentId;
      const call = (id: string) => {
        const req = http()[row.method](row.path(id)).set(outsider.mutation);
        return row.body ? req.send(row.body) : req;
      };
      const theirs = await call(target);
      const unknown = await call(randomUUID());
      expect({ route: row.route, status: theirs.status, code: theirs.body.code }).toEqual({
        route: row.route,
        status: 404,
        code: unknown.body.code,
      });
      expect(unknown.status).toBe(404);
    }
    expect(JSON.stringify([...conversations.comments.comments.values()])).toBe(before);
    expect(conversations.comments.reactions.size).toBe(reactions);
    expect(JSON.stringify([...conversations.follows.follows.entries()])).toBe(follows);
    expect(PHASE4_IDOR_ROUTES.filter((route) => !table.some((r) => r.route === route))).toEqual([]);
  });
});

describe('Critère de sortie : le destinataire ne peut rien observer de l’activité des offreurs', () => {
  it('toutes ses lectures sont identiques avant et après la préparation entre offreurs', async () => {
    const { lea, paul, listId, itemId } = await world();
    const marc = await person();
    await link(lea, marc);
    const reads = [
      '/api/v1/notifications',
      '/api/v1/notifications/unread-count',
      '/api/v1/sync?since=0',
      `/api/v1/items/${itemId}/threads`,
      `/api/v1/items/${itemId}/comments?thread=PUBLIC`,
      `/api/v1/lists/${listId}/items`,
      `/api/v1/lists/${listId}`,
      '/api/v1/lists',
      '/api/v1/notification-preferences',
    ];
    const snapshot = async (): Promise<string[]> => {
      await conversations.settle();
      const out: string[] = [];
      for (const path of reads) {
        const res = await http().get(path).set({ Cookie: lea.cookie });
        out.push(`${path} ${res.status} ${JSON.stringify({ ...res.body, requestId: null })}`);
      }
      return out;
    };
    const before = await snapshot();

    // Préparation : fil Offreurs, mentions de la destinataire, réactions, suivi, suggestion
    // commentée, suppression d'un message d'offreur.
    const secret = await http()
      .post(`/api/v1/items/${itemId}/comments`)
      .set(paul.mutation)
      .send({ thread: 'GIVERS', body: 'Je le prends', mentionIds: [lea.profileId] })
      .expect(201);
    await http()
      .post(`/api/v1/items/${itemId}/comments`)
      .set(marc.mutation)
      .send({ thread: 'GIVERS', body: 'Je participe', mentionIds: [paul.profileId] })
      .expect(201);
    await http()
      .put(`/api/v1/comments/${secret.body.id as string}/reactions/PARTY`)
      .set(marc.mutation)
      .expect(204);
    await http().put(`/api/v1/items/${itemId}/follow`).set(marc.mutation).expect(204);
    const product = await http()
      .post('/api/v1/products')
      .set(paul.mutation)
      .send({ title: 'Casque' })
      .expect(201);
    const suggestion = await http()
      .post(`/api/v1/lists/${listId}/items`)
      .set(paul.mutation)
      .send({ productId: product.body.id as string, isSuggestion: true })
      .expect(201);
    await http()
      .post(`/api/v1/items/${suggestion.body.id as string}/comments`)
      .set(marc.mutation)
      .send({ thread: 'GIVERS', body: 'Bonne idée', mentionIds: [lea.profileId] })
      .expect(201);
    await http()
      .delete(`/api/v1/comments/${secret.body.id as string}`)
      .set(paul.mutation)
      .expect(204);

    expect(await snapshot()).toEqual(before);
  });
});
