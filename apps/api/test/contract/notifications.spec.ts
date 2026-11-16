import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SecurityLog } from '../../src/modules/identity/testing';
import type { SignedIn } from '../support/sign-in';
import {
  createTestApp,
  type TestConversations,
  type TestEvents,
  type TestIdentity,
} from './create-test-app';

// Notifications (06, NOT-05, NOT-10 à NOT-18, RT-12), API montée, ports en mémoire.

let app: INestApplication;
let identity: TestIdentity;
let events: TestEvents;
let conversations: TestConversations;

beforeAll(async () => {
  ({ app, identity, events, conversations } = await createTestApp());
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

async function person(name?: string): Promise<SignedIn> {
  const user = await identity.signIn(name ? { displayName: name } : {});
  identity.accounts.seed({ id: user.accountId, email: `p-${user.accountId}@lahotte.test` });
  return user;
}

async function center(user: SignedIn): Promise<Body[]> {
  await conversations.settle();
  const res = await http().get('/api/v1/notifications').set({ Cookie: user.cookie }).expect(200);
  return res.body.items as Body[];
}

async function unread(user: SignedIn): Promise<number> {
  await conversations.settle();
  const res = await http()
    .get('/api/v1/notifications/unread-count')
    .set({ Cookie: user.cookie })
    .expect(200);
  return res.body.count as number;
}

/** Léa tient sa wishlist ; Paul et Marc sont de son cercle. */
async function world() {
  const lea = await person('Léa');
  const paul = await person('Paul');
  const marc = await person('Marc');
  await link(lea, paul);
  await link(lea, marc);
  const list = await http()
    .post('/api/v1/lists')
    .set(lea.mutation)
    .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [lea.profileId] })
    .expect(201);
  const product = await http()
    .post('/api/v1/products')
    .set(lea.mutation)
    .send({ title: 'Vélo rouge' })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${list.body.id as string}/items`)
    .set(lea.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  await conversations.settle();
  return { lea, paul, marc, listId: list.body.id as string, itemId: item.body.id as string };
}

function comment(user: SignedIn, itemId: string, thread: string, body: Body = {}) {
  return http()
    .post(`/api/v1/items/${itemId}/comments`)
    .set(user.mutation)
    .send({ thread, body: 'Message', ...body })
    .expect(201);
}

describe('NOT-05, NOT-10 : production par candidat à travers le moteur', () => {
  it('un message du fil Offreurs ne notifie jamais la destinataire, qui suit l’élément', async () => {
    const { lea, paul, marc, itemId } = await world();
    await comment(marc, itemId, 'GIVERS', { body: 'Je suis là' });
    await comment(paul, itemId, 'GIVERS', { body: 'Je prends' });
    expect(await center(lea)).toEqual([]);
    expect(await unread(lea)).toBe(0);
    const forMarc = await center(marc);
    expect(forMarc).toHaveLength(1);
    expect(forMarc[0]).toMatchObject({
      type: 'comment.created',
      category: 'COMMENTS',
      title: 'Vélo rouge',
      context: 'Noël',
      thread: 'GIVERS',
      actorName: 'Paul',
      read: false,
    });
    // L'auteur n'est jamais notifié de son propre geste.
    expect(await center(paul)).toEqual([]);
  });

  it('fil Public : la destinataire est notifiée ; mentionnée, elle reçoit MENTIONS et pas COMMENTS', async () => {
    const { lea, paul, itemId } = await world();
    await comment(paul, itemId, 'PUBLIC', { body: 'Quelle taille ?' });
    await comment(paul, itemId, 'PUBLIC', { body: '@Léa ?', mentionIds: [lea.profileId] });
    const types = (await center(lea)).map((n) => n.type);
    expect(types).toEqual(['comment.mention', 'comment.created']);
  });

  it('NOT-11 : une notification dont le sujet devient invisible disparaît, compteur compris', async () => {
    const { lea, paul, marc, itemId } = await world();
    await comment(marc, itemId, 'GIVERS');
    await comment(paul, itemId, 'GIVERS');
    expect(await unread(marc)).toBe(1);
    const item = await http().get(`/api/v1/items/${itemId}`).set({ Cookie: lea.cookie });
    await http()
      .put(`/api/v1/items/${itemId}/visibility`)
      .set({ ...lea.mutation, 'If-Match': String(item.body.version) })
      .send({ mode: 'EXCEPT', profileIds: [marc.profileId] })
      .expect(200);
    expect(await center(marc)).toEqual([]);
    expect(await unread(marc)).toBe(0);
    const sync = await http().get('/api/v1/sync?since=0').set({ Cookie: marc.cookie }).expect(200);
    expect(sync.body).toMatchObject({ notifications: [], reset: false });
  });
});

describe('NOT-12 : invitations, annulation, rappels (EVT-13, EVT-15, EVT-34)', () => {
  it('invité notifié ; annulation à tous les participants ; rappel une seule fois', async () => {
    const org = await person('Org');
    const guest = await person('Invité');
    await link(org, guest);
    const created = await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Noël', date: '2027-12-24', type: 'CHRISTMAS' })
      .expect(201);
    const eventId = created.body.id as string;
    await http()
      .post(`/api/v1/events/${eventId}/participants`)
      .set(org.mutation)
      .send({ profileIds: [guest.profileId] })
      .expect(200);
    expect((await center(guest)).map((n) => n.type)).toEqual(['event.invited']);

    events.events.force(eventId, {
      date: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
    });
    expect(await events.remind()).toBe(1);
    expect(await events.remind()).toBe(0);
    await http().post(`/api/v1/events/${eventId}/cancel`).set(org.mutation).expect(200);
    expect((await center(guest)).map((n) => n.type)).toEqual([
      'event.cancelled',
      'event.reminder',
      'event.invited',
    ]);
    expect(await center(org)).toEqual([]);
  });

  it('EVT-04 : l’honoré d’une surprise ne reçoit rien de l’événement', async () => {
    const org = await person();
    const honoree = await person();
    const friend = await person();
    await link(org, honoree);
    await link(org, friend);
    const created = await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({
        title: 'Les 40 ans',
        date: '2027-06-01',
        type: 'BIRTHDAY',
        isSurprise: true,
        honoreeIds: [honoree.profileId],
      })
      .expect(201);
    await http()
      .post(`/api/v1/events/${created.body.id as string}/participants`)
      .set(org.mutation)
      .send({ profileIds: [friend.profileId] })
      .expect(200);
    expect(await center(friend)).toHaveLength(1);
    expect(await center(honoree)).toEqual([]);
  });
});

describe('NOT-04, NOT-12 : sécurité et préférences', () => {
  it('avis de compte à tous les profils ; la sécurité ne se désactive pas ; in-app désactivé tait', async () => {
    const { paul, marc, itemId } = await world();
    await http()
      .put('/api/v1/notification-preferences')
      .set(marc.mutation)
      .send({
        channels: [
          { category: 'SECURITY', channel: 'IN_APP', enabled: false },
          { category: 'COMMENTS', channel: 'IN_APP', enabled: false },
        ],
        quietEnabled: false,
        quietStart: 0,
        quietEnd: 0,
        digest: 'WEEKLY',
        sharePresence: false,
      })
      .expect(200)
      .expect((res) => {
        const security = (res.body.channels as Body[]).find(
          (c) => c.category === 'SECURITY' && c.channel === 'IN_APP',
        );
        expect(security).toMatchObject({ enabled: true, locked: true });
      });
    await comment(marc, itemId, 'GIVERS');
    await comment(paul, itemId, 'GIVERS');
    await app.get(SecurityLog).record({
      accountId: marc.accountId,
      event: 'totp.enabled',
      ip: '127.0.0.1',
      userAgent: 'test',
      at: new Date(),
    });
    expect((await center(marc)).map((n) => n.type)).toEqual(['security.totp_enabled']);
  });

  it('NOT-18 : marquer lu ; RT-12 : rattrapage et reset', async () => {
    const { lea, paul, itemId } = await world();
    await comment(paul, itemId, 'PUBLIC');
    await comment(paul, itemId, 'PUBLIC');
    expect(await unread(lea)).toBe(2);
    const [latest] = await center(lea);
    await http()
      .post('/api/v1/notifications/read')
      .set(lea.mutation)
      .send({ ids: [latest!.id] })
      .expect(204);
    expect(await unread(lea)).toBe(1);
    await http()
      .post('/api/v1/notifications/read')
      .set(lea.mutation)
      .send({ upToSeq: 99 })
      .expect(204);
    expect(await unread(lea)).toBe(0);
    const sync = await http().get('/api/v1/sync?since=1').set({ Cookie: lea.cookie }).expect(200);
    expect(sync.body).toMatchObject({ lastSeq: 2, reset: false });
    expect((sync.body.notifications as Body[]).map((n) => n.seq)).toEqual([2]);
    const ahead = await http().get('/api/v1/sync?since=50').set({ Cookie: lea.cookie }).expect(200);
    expect(ahead.body.reset).toBe(true);
  });
});
