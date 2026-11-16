import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import {
  createTestApp,
  type TestCatalog,
  type TestEvents,
  type TestIdentity,
} from './create-test-app';

// Reprise des souhaits non obtenus et pioche (EVT-20 à EVT-23, EVT-26 à EVT-28, LST-14, VIS-35).
// Critère de 05 : le contenu de l'étape 1 est identique que les souhaits passés soient ouverts,
// réservés ou achetés.

let app: INestApplication;
let identity: TestIdentity;
let catalog: TestCatalog;
let events: TestEvents;

beforeAll(async () => {
  ({ app, identity, catalog, events } = await createTestApp());
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

/** Échange organisé par `org`, `me` invité et présent ; rend l'événement et la liste de `me`. */
async function exchange(
  org: SignedIn,
  me: SignedIn,
  title: string,
): Promise<{ eventId: string; listId: string }> {
  const res = await http()
    .post('/api/v1/events')
    .set(org.mutation)
    .send({ title, date: '2027-12-24', type: 'CHRISTMAS' })
    .expect(201);
  const eventId = res.body.id as string;
  await http()
    .post(`/api/v1/events/${eventId}/participants`)
    .set(org.mutation)
    .send({ profileIds: [me.profileId] })
    .expect(200);
  const answer = await http()
    .put(`/api/v1/events/${eventId}/rsvp`)
    .set(me.mutation)
    .send({ rsvp: 'YES' })
    .expect(200);
  return { eventId, listId: answer.body.listId as string };
}

async function addItem(user: SignedIn, listId: string, title: string): Promise<Body> {
  const product = await http()
    .post('/api/v1/products')
    .set(user.mutation)
    .send({ title, unitPriceMinor: 2500 })
    .expect(201);
  const res = await http()
    .post(`/api/v1/lists/${listId}/items`)
    .set(user.mutation)
    .send({ productId: product.body.id as string, note: `note ${title}` })
    .expect(201);
  return res.body as Body;
}

function setStatus(itemId: string, status: 'OPEN' | 'RESERVED' | 'PURCHASED'): void {
  const row = catalog.items.items.get(itemId)!;
  catalog.items.items.set(itemId, { ...row, status });
}

async function candidates(user: SignedIn, eventId: string): Promise<Body[]> {
  const res = await http()
    .get(`/api/v1/events/${eventId}/carry-over`)
    .set({ Cookie: user.cookie })
    .expect(200);
  return res.body.items as Body[];
}

/** Monde : Léa a une liste de Noël 2025 (passé) et répond Participe à Noël 2027. */
async function world() {
  const org = await person();
  const lea = await person();
  const giver = await person();
  await link(org, lea);
  await link(org, giver);
  const old = await exchange(org, lea, 'Noël 2025');
  await http()
    .post(`/api/v1/events/${old.eventId}/participants`)
    .set(org.mutation)
    .send({ profileIds: [giver.profileId] })
    .expect(200);
  await http()
    .put(`/api/v1/events/${old.eventId}/rsvp`)
    .set(giver.mutation)
    .send({ rsvp: 'YES' })
    .expect(200);
  const bike = await addItem(lea, old.listId, 'Vélo');
  const book = await addItem(lea, old.listId, 'Livre');
  const lamp = await addItem(lea, old.listId, 'Lampe');
  events.events.force(old.eventId, { date: '2025-12-24' });
  const next = await exchange(org, lea, 'Noël 2027');
  await http()
    .post(`/api/v1/events/${next.eventId}/participants`)
    .set(org.mutation)
    .send({ profileIds: [giver.profileId] })
    .expect(200);
  await http()
    .put(`/api/v1/events/${next.eventId}/rsvp`)
    .set(giver.mutation)
    .send({ rsvp: 'YES' })
    .expect(200);
  return { org, lea, giver, old, next, bike, book, lamp };
}

describe('EVT-22 : souhaits non obtenus', () => {
  it('critère de 05 : réponse identique quel que soit l’état réel ; reçus et retirés absents', async () => {
    const { lea, next, bike, book, lamp } = await world();
    const ids = [bike, book, lamp].map((i) => i.id as string);
    const snapshots: string[] = [];
    for (const status of ['OPEN', 'RESERVED', 'PURCHASED'] as const) {
      for (const id of ids) setStatus(id, status);
      const res = await http()
        .get(`/api/v1/events/${next.eventId}/carry-over`)
        .set({ Cookie: lea.cookie })
        .expect(200);
      snapshots.push(res.text);
    }
    expect(snapshots[1]).toBe(snapshots[0]);
    expect(snapshots[2]).toBe(snapshots[0]);
    // Un secret réservé ou acheté y figure comme les autres.
    expect((await candidates(lea, next.eventId)).map((c) => (c.item as Body).id)).toEqual(ids);
    // Reçu (LST-14) et retiré (LST-15) : absents.
    await http()
      .post(`/api/v1/items/${book.id as string}/received`)
      .set(lea.mutation)
      .expect(200);
    await http()
      .post(`/api/v1/items/${lamp.id as string}/withdraw`)
      .set(lea.mutation)
      .send({ reason: 'NO_LONGER_WANTED' })
      .expect(204);
    const after = await candidates(lea, next.eventId);
    expect(after.map((c) => (c.item as Body).id)).toEqual([bike.id]);
    expect(after[0]).toMatchObject({
      event: { title: 'Noël 2025', date: '2025-12-24' },
      item: { view: 'recipient', carriedForward: false },
    });
    expect(Object.keys(after[0]!.item as Body)).not.toContain('status');
    expect(Object.keys(after[0]!.item as Body)).not.toContain('position');
  });

  it('un événement pas encore passé ne fournit rien ; l’événement courant non plus', async () => {
    const org = await person();
    const lea = await person();
    await link(org, lea);
    const first = await exchange(org, lea, 'Anniv');
    await addItem(lea, first.listId, 'Puzzle');
    const second = await exchange(org, lea, 'Noël');
    expect(await candidates(lea, second.eventId)).toEqual([]);
    expect(await candidates(lea, first.eventId)).toEqual([]);
  });

  it('un profil qui ne participe pas reçoit 404 ; un offreur ne voit pas les souhaits des autres', async () => {
    const { giver, next } = await world();
    const stranger = await person();
    await http()
      .get(`/api/v1/events/${next.eventId}/carry-over`)
      .set({ Cookie: stranger.cookie })
      .expect(404);
    expect(await candidates(giver, next.eventId)).toEqual([]);
  });
});

describe('EVT-21, EVT-27, EVT-28 : reprise', () => {
  it('nouvel élément lié ; l’ancien porte « reporté » ; une seule reprise ; mention offreur', async () => {
    const { lea, giver, next, bike } = await world();
    setStatus(bike.id as string, 'PURCHASED');
    const res = await http()
      .post(`/api/v1/events/${next.eventId}/carry-over`)
      .set(lea.mutation)
      .send({ listId: next.listId, itemIds: [bike.id] })
      .expect(201);
    const created = (res.body.items as Body[])[0]!;
    expect(created).toMatchObject({
      view: 'recipient',
      listId: next.listId,
      note: 'note Vélo',
      carriedForward: false,
    });
    expect(Object.keys(created)).not.toContain('carriedFrom');
    // L'ancien : reporté, vu ainsi par Léa.
    const oldView = await http()
      .get(`/api/v1/items/${bike.id as string}`)
      .set({ Cookie: lea.cookie })
      .expect(200);
    expect(oldView.body.carriedForward).toBe(true);
    // Une seule reprise ; plus proposé.
    await http()
      .post(`/api/v1/events/${next.eventId}/carry-over`)
      .set(lea.mutation)
      .send({ listId: next.listId, itemIds: [bike.id] })
      .expect(422);
    expect((await candidates(lea, next.eventId)).some((c) => (c.item as Body).id === bike.id)).toBe(
      false,
    );
    // EVT-28 : l'offreur, participant de l'ancien événement, voit la mention titrée ; le neuf part
    // neutre.
    const giverView = await http()
      .get(`/api/v1/items/${created.id as string}`)
      .set({ Cookie: giver.cookie })
      .expect(200);
    expect(giverView.body).toMatchObject({
      view: 'giver',
      status: 'OPEN',
      carriedFrom: { status: 'PURCHASED', event: { title: 'Noël 2025', date: '2025-12-24' } },
    });
  });

  it('EVT-28 : un offreur qui n’était pas de l’ancien événement voit la mention sans titre', async () => {
    const { org, lea, next, book } = await world();
    const newcomer = await person();
    await link(org, newcomer);
    await http()
      .post(`/api/v1/events/${next.eventId}/participants`)
      .set(org.mutation)
      .send({ profileIds: [newcomer.profileId] })
      .expect(200);
    await http()
      .put(`/api/v1/events/${next.eventId}/rsvp`)
      .set(newcomer.mutation)
      .send({ rsvp: 'YES' })
      .expect(200);
    setStatus(book.id as string, 'RESERVED');
    const res = await http()
      .post(`/api/v1/events/${next.eventId}/carry-over`)
      .set(lea.mutation)
      .send({ listId: next.listId, itemIds: [book.id] })
      .expect(201);
    const created = (res.body.items as Body[])[0]!;
    const view = await http()
      .get(`/api/v1/items/${created.id as string}`)
      .set({ Cookie: newcomer.cookie })
      .expect(200);
    expect(view.body.carriedFrom).toEqual({ status: 'RESERVED', event: null });
  });

  it('refus : liste d’un autre, élément hors des non obtenus', async () => {
    const { lea, giver, next, bike } = await world();
    const giverList = await http()
      .get(`/api/v1/lists?eventId=${next.eventId}`)
      .set({ Cookie: giver.cookie })
      .expect(200);
    const own = (giverList.body.items as Body[]).find((l) => l.view === 'recipient')!;
    await http()
      .post(`/api/v1/events/${next.eventId}/carry-over`)
      .set(giver.mutation)
      .send({ listId: own.id, itemIds: [bike.id] })
      .expect(422);
    await http()
      .post(`/api/v1/events/${next.eventId}/carry-over`)
      .set(lea.mutation)
      .send({ listId: own.id, itemIds: [bike.id] })
      .expect(403);
  });
});

describe('EVT-20 étape 2, EVT-23 : pioche', () => {
  it('Mes envies et les listes vues en offreur, par recherche', async () => {
    const { lea, giver, next } = await world();
    const personal = await http().get('/api/v1/lists').set({ Cookie: giver.cookie }).expect(200);
    const mine = (personal.body.items as Body[]).find((l) => l.personal === true)!;
    await addItem(giver, mine.id as string, 'Vélo de course');
    const res = await http()
      .get(`/api/v1/events/${next.eventId}/ideas?q=v%C3%A9lo`)
      .set({ Cookie: giver.cookie })
      .expect(200);
    const titles = (res.body.items as Body[]).map((i) => (i.product as Body).title);
    // Son « Mes envies » et le vélo de Léa (liste de Noël 2025, vue en offreur).
    expect(titles).toEqual(expect.arrayContaining(['Vélo de course', 'Vélo']));
    await http()
      .get(`/api/v1/events/${next.eventId}/ideas?q=v`)
      .set({ Cookie: (await person()).cookie })
      .expect(404);
    expect(lea).toBeDefined();
  });
});
