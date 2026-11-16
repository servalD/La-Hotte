import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { type SignedIn, WEB_ORIGIN } from '../support/sign-in';
import { createTestApp, type TestConversations, type TestIdentity } from './create-test-app';

// QA-13 : temps réel à plusieurs clients simultanés ; ce que chacun reçoit ET ne reçoit pas (RT-01 à
// RT-12, API-30 à API-36, critères de 06).

let app: INestApplication;
let identity: TestIdentity;
let conversations: TestConversations;
let url: string;
const open: Socket[] = [];

beforeAll(async () => {
  ({ app, identity, conversations } = await createTestApp());
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer() as { address(): AddressInfo };
  const { port } = server.address();
  url = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const socket of open) socket.disconnect();
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
});

const http = () => request(app.getHttpServer());
type Frame = { type: string; room: string; data: Record<string, unknown>; seq?: number };

interface Client {
  readonly socket: Socket;
  readonly frames: Frame[];
  subscribe(room: string): Promise<boolean>;
}

async function connect(user: SignedIn, origin = WEB_ORIGIN): Promise<Client> {
  const socket = io(url, {
    path: '/realtime',
    transports: ['websocket'],
    extraHeaders: { cookie: user.cookie, origin },
    reconnection: false,
    forceNew: true,
  });
  open.push(socket);
  const frames: Frame[] = [];
  socket.on('message', (frame: Frame) => frames.push(frame));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => {
      resolve();
    });
    socket.once('connect_error', reject);
  });
  // La poignée de main est vérifiée après l'ouverture : attendre un aller-retour.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return {
    socket,
    frames,
    subscribe: async (room) =>
      ((await socket.timeout(2000).emitWithAck('subscribe', { room })) as { ok: boolean }).ok,
  };
}

async function settle(): Promise<void> {
  await conversations.settle();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await conversations.settle();
}

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
  const marc = await person();
  await link(lea, paul);
  await link(lea, marc);
  const list = await http()
    .post('/api/v1/lists')
    .set(lea.mutation)
    .send({ type: 'WISHLIST', title: 'Noël secret', recipientIds: [lea.profileId] })
    .expect(201);
  const product = await http()
    .post('/api/v1/products')
    .set(lea.mutation)
    .send({ title: 'Vélo turquoise' })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${list.body.id as string}/items`)
    .set(lea.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  await settle();
  return { lea, paul, marc, listId: list.body.id as string, itemId: item.body.id as string };
}

function comment(user: SignedIn, itemId: string, thread: string, body: string) {
  return http()
    .post(`/api/v1/items/${itemId}/comments`)
    .set(user.mutation)
    .send({ thread, body })
    .expect(201);
}

describe('RT-01, API-30 : poignée de main', () => {
  it('sans session, ou d’une autre origine : fermée', async () => {
    const lea = await person();
    for (const [user, origin] of [
      [{ ...lea, cookie: '' }, WEB_ORIGIN],
      [lea, 'https://evil.example'],
    ] as const) {
      const socket = io(url, {
        path: '/realtime',
        transports: ['websocket'],
        extraHeaders: { cookie: user.cookie, origin },
        reconnection: false,
        forceNew: true,
      });
      open.push(socket);
      await new Promise<void>((resolve) => {
        socket.once('disconnect', () => {
          resolve();
        });
        socket.once('connect_error', () => {
          resolve();
        });
      });
      expect(socket.connected).toBe(false);
    }
  });
});

describe('RT-03, RT-08, critères de 06 : destinataire et offreurs', () => {
  it('le destinataire est refusé au salon d’offreurs et ne reçoit aucune trame d’offreur', async () => {
    const { lea, paul, listId, itemId } = await world();
    const leaClient = await connect(lea);
    const paulClient = await connect(paul);
    expect(await leaClient.subscribe(`item:${itemId}:givers`)).toBe(false);
    expect(await leaClient.subscribe(`item:${itemId}:public`)).toBe(true);
    expect(await leaClient.subscribe(`list:${listId}`)).toBe(true);
    expect(await paulClient.subscribe(`item:${itemId}:givers`)).toBe(true);
    expect(await paulClient.subscribe(`item:${itemId}:public`)).toBe(true);
    // Formes inconnues refusées sans distinction (API-36).
    expect(await leaClient.subscribe(`profile:${paul.profileId as string}`)).toBe(false);
    expect(await leaClient.subscribe('item:nimporte:quoi')).toBe(false);

    const givers = await comment(paul, itemId, 'GIVERS', 'Je prends le vélo turquoise');
    await settle();
    expect(paulClient.frames).toContainEqual(
      expect.objectContaining({
        type: 'comment.created',
        room: `item:${itemId}:givers`,
        data: { itemId, thread: 'GIVERS', commentId: givers.body.id },
      }),
    );
    expect(leaClient.frames).toEqual([]);

    await comment(paul, itemId, 'PUBLIC', 'Quelle taille ?');
    await settle();
    const types = leaClient.frames.map((f) => `${f.type}@${f.room}`);
    expect(types).toContain(`comment.created@item:${itemId}:public`);
    // La destinataire suit l'élément : sa notification arrive avec son numéro (RT-12).
    const notification = leaClient.frames.find((f) => f.type === 'notification.created');
    expect(notification).toMatchObject({ room: `profile:${lea.profileId as string}`, seq: 1 });
    // RT-08 : aucune trame ne porte de contenu.
    const all = JSON.stringify([...leaClient.frames, ...paulClient.frames]);
    for (const text of ['turquoise', 'taille', 'Noël', 'Vélo']) expect(all).not.toContain(text);
    expect(leaClient.frames.some((f) => f.data.commentId === givers.body.id)).toBe(false);
  });

  it('RT-07, RT-10 : retiré par la règle, l’offreur quitte le salon et ne reçoit plus rien', async () => {
    const { lea, paul, marc, itemId } = await world();
    const marcClient = await connect(marc);
    expect(await marcClient.subscribe(`item:${itemId}:givers`)).toBe(true);
    const item = await http().get(`/api/v1/items/${itemId}`).set({ Cookie: lea.cookie });
    await http()
      .put(`/api/v1/items/${itemId}/visibility`)
      .set({ ...lea.mutation, 'If-Match': String(item.body.version) })
      .send({ mode: 'EXCEPT', profileIds: [marc.profileId] })
      .expect(200);
    await settle();
    expect(marcClient.frames).toContainEqual(
      expect.objectContaining({
        type: 'access.revoked',
        data: { room: `item:${itemId}:givers` },
      }),
    );
    marcClient.frames.length = 0;
    await comment(paul, itemId, 'GIVERS', 'Commandé');
    await settle();
    expect(marcClient.frames).toEqual([]);
    expect(await marcClient.subscribe(`item:${itemId}:givers`)).toBe(false);
  });

  it('RT-05, RT-11 : présence et saisie entre offreurs seulement, jamais au destinataire', async () => {
    const { lea, paul, marc, itemId } = await world();
    const leaClient = await connect(lea);
    const paulClient = await connect(paul);
    const marcClient = await connect(marc);
    await leaClient.subscribe(`item:${itemId}:public`);
    await paulClient.subscribe(`item:${itemId}:givers`);
    await marcClient.subscribe(`item:${itemId}:givers`);
    paulClient.socket.emit('typing', { itemId });
    // La destinataire n'est pas abonnée au salon d'offreurs : sa présence est ignorée.
    leaClient.socket.emit('presence', { itemId, present: true });
    await settle();
    expect(marcClient.frames).toContainEqual(
      expect.objectContaining({
        type: 'typing',
        data: { itemId, profileId: paul.profileId, present: true },
      }),
    );
    expect(paulClient.frames.some((f) => f.type === 'typing')).toBe(false);
    expect(leaClient.frames).toEqual([]);
    expect(marcClient.frames.some((f) => f.data.profileId === lea.profileId)).toBe(false);
  });

  it('ADR 0013 : une session révoquée ferme ses sockets', async () => {
    const { paul } = await world();
    const client = await connect(paul);
    const closed = new Promise<void>((resolve) =>
      client.socket.once('disconnect', () => {
        resolve();
      }),
    );
    await http().post('/api/v1/auth/logout').set(paul.mutation).expect(204);
    await closed;
    expect(client.socket.connected).toBe(false);
  });
});
