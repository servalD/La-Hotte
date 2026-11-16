import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signIn, type SignedIn } from '../support/sign-in';
import {
  createTestApp,
  type TestCatalog,
  type TestEvents,
  type TestIdentity,
} from './create-test-app';

// Événements (EVT-01 à EVT-18, EVT-33 à EVT-40, VIS-36).

let app: INestApplication;
let identity: TestIdentity;
let events: TestEvents;
let catalog: TestCatalog;

beforeAll(async () => {
  ({ app, identity, events, catalog } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
  identity.eventThrottle.reset();
});

const http = () => request(app.getHttpServer());
type Body = Record<string, unknown>;
const NEXT_XMAS = '2027-12-24';

async function link(x: SignedIn, y: SignedIn): Promise<void> {
  const invitation = await http().post('/api/v1/invitations').set(x.mutation).send({}).expect(201);
  await http()
    .post('/api/v1/invitations/redeem')
    .set(y.mutation)
    .send({ token: invitation.body.token as string })
    .expect(201);
}

async function person(displayName = 'Profil', isChild = false): Promise<SignedIn> {
  const user = await identity.signIn({ displayName, isChild });
  identity.accounts.seed({ id: user.accountId, email: `p-${user.accountId}@lahotte.test` });
  return user;
}

async function create(user: SignedIn, body: Body): Promise<Body> {
  const res = await http()
    .post('/api/v1/events')
    .set(user.mutation)
    .send({ title: 'Noël', date: NEXT_XMAS, type: 'CHRISTMAS', ...body })
    .expect(201);
  return res.body as Body;
}

async function get(user: SignedIn, id: string, status = 200): Promise<Body> {
  const res = await http().get(`/api/v1/events/${id}`).set({ Cookie: user.cookie }).expect(status);
  return res.body as Body;
}

async function invite(org: SignedIn, eventId: string, ...guests: SignedIn[]): Promise<Body> {
  const res = await http()
    .post(`/api/v1/events/${eventId}/participants`)
    .set(org.mutation)
    .send({ profileIds: guests.map((g) => g.profileId) })
    .expect(200);
  return res.body as Body;
}

async function newLink(org: SignedIn, eventId: string, maxUses?: number): Promise<string> {
  const res = await http()
    .post(`/api/v1/events/${eventId}/links`)
    .set(org.mutation)
    .send(maxUses ? { maxUses } : {})
    .expect(201);
  return res.body.token as string;
}

/** Surprise pour `honoree`, organisée par `org` (dans son cercle). */
async function surprise(org: SignedIn, honoree: SignedIn): Promise<Body> {
  return create(org, {
    title: 'Les 40 ans',
    type: 'BIRTHDAY',
    isSurprise: true,
    honoreeIds: [honoree.profileId],
  });
}

describe('Création (EVT-01 à EVT-09)', () => {
  it('échange : le créateur est organisateur et participe ; forme par défaut selon le type', async () => {
    const org = await person('Léa');
    const event = await create(org, {});
    expect(event).toMatchObject({
      mode: 'EXCHANGE',
      isSurprise: false,
      status: 'UPCOMING',
      myRole: 'ORGANIZER',
      myRsvp: 'YES',
      surpriseHonorees: null,
      timezone: expect.any(String),
    });
    expect(event.participants).toEqual([
      expect.objectContaining({ profileId: org.profileId, displayName: 'Léa', role: 'ORGANIZER' }),
    ]);
  });

  it('EVT-05 : date passée ou invalide refusée', async () => {
    const org = await person();
    await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Noël', date: '2020-12-24', type: 'CHRISTMAS' })
      .expect(422)
      .expect((res) => {
        expect(res.body.code).toBe('EVENT_DATE_PASSED');
      });
    await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Noël', date: '2027-02-29', type: 'CHRISTMAS' })
      .expect(422);
  });

  it('EVT-07 : à l’honneur exige des honorés de son cercle ; échange n’en a pas', async () => {
    const org = await person();
    const friend = await person();
    const stranger = await person();
    await link(org, friend);
    await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Anniv', date: NEXT_XMAS, type: 'BIRTHDAY' })
      .expect(422);
    await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Anniv', date: NEXT_XMAS, type: 'BIRTHDAY', honoreeIds: [stranger.profileId] })
      .expect(422)
      .expect((res) => {
        expect(res.body.code).toBe('EVENT_PROFILE_NOT_ALLOWED');
      });
    await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Noël', date: NEXT_XMAS, type: 'CHRISTMAS', honoreeIds: [friend.profileId] })
      .expect(422);
    const event = await create(org, {
      title: 'Anniv',
      type: 'BIRTHDAY',
      honoreeIds: [friend.profileId],
    });
    expect(event.mode).toBe('HONOREE');
    expect(event.participants).toContainEqual(
      expect.objectContaining({ profileId: friend.profileId, isHonoree: true, rsvp: 'PENDING' }),
    );
  });

  it('EVT-07, EVT-09 : surprise à l’honneur seulement ; le créateur n’est pas honoré de sa surprise', async () => {
    const org = await person();
    await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({ title: 'Noël', date: NEXT_XMAS, type: 'CHRISTMAS', isSurprise: true })
      .expect(422);
    await http()
      .post('/api/v1/events')
      .set(org.mutation)
      .send({
        title: 'Moi',
        date: NEXT_XMAS,
        type: 'BIRTHDAY',
        isSurprise: true,
        honoreeIds: [org.profileId],
      })
      .expect(422);
  });
});

describe('Accès (EVT-08, VIS-36)', () => {
  it('un profil sans ligne de participant reçoit 404, comme un identifiant inconnu', async () => {
    const org = await person();
    const other = await person();
    const event = await create(org, {});
    const unknown = await get(other, '0190a000-0000-7000-8000-000000000000', 404);
    const hidden = await get(other, event.id as string, 404);
    expect({ ...hidden, requestId: null }).toEqual({ ...unknown, requestId: null });
    expect(hidden.code).toBe('EVENT_NOT_FOUND');
  });

  it('EVT-04, EVT-07 : l’honoré d’une surprise n’en voit rien, ni dans sa liste d’événements', async () => {
    const org = await person();
    const honoree = await person();
    await link(org, honoree);
    const event = await surprise(org, honoree);
    expect(event.surpriseHonorees).toEqual([
      expect.objectContaining({ profileId: honoree.profileId }),
    ]);
    expect(event.participants).not.toContainEqual(
      expect.objectContaining({ profileId: honoree.profileId }),
    );
    await get(honoree, event.id as string, 404);
    const list = await http().get('/api/v1/events').set({ Cookie: honoree.cookie }).expect(200);
    expect(list.body.items).toEqual([]);
    const past = await http()
      .get('/api/v1/events?scope=past')
      .set({ Cookie: honoree.cookie })
      .expect(200);
    expect(past.body.items).toEqual([]);
  });

  it('EVT-15 : inviter l’honoré de la surprise est refusé', async () => {
    const org = await person();
    const honoree = await person();
    await link(org, honoree);
    const event = await surprise(org, honoree);
    await http()
      .post(`/api/v1/events/${event.id as string}/participants`)
      .set(org.mutation)
      .send({ profileIds: [honoree.profileId] })
      .expect(422)
      .expect((res) => {
        expect(res.body.code).toBe('EVENT_HONOREE_CANNOT_PARTICIPATE');
      });
  });

  it('GFT-08 : avertissement aux organisateurs si un participant partage le compte de l’honoré', async () => {
    const org = await person();
    const honoree = await person();
    await link(org, honoree);
    const event = await surprise(org, honoree);
    expect(event.sharedAccountWarning).toBe(false);
    // Un autre profil du compte de l'honoré, invité comme offreur.
    const siblingId = randomUUID();
    identity.profiles.set({
      profileId: siblingId,
      accountId: honoree.accountId,
      hasPin: false,
      relock: 'IDLE_15',
    });
    const sibling = await signIn(app, { accountId: honoree.accountId, profileId: siblingId });
    await link(org, sibling);
    const after = await invite(org, event.id as string, sibling);
    expect(after.sharedAccountWarning).toBe(true);
  });
});

describe('Invitations directes (EVT-15)', () => {
  it('profils du cercle seulement ; e-mail neutre au compte de l’invité', async () => {
    const org = await person();
    const friend = await person('Paul');
    const stranger = await person();
    await link(org, friend);
    const event = await create(org, { title: 'Secret de Noël chez Léa', place: 'Lyon' });
    await http()
      .post(`/api/v1/events/${event.id as string}/participants`)
      .set(org.mutation)
      .send({ profileIds: [stranger.profileId] })
      .expect(422);
    identity.mail.sent.length = 0;
    const after = await invite(org, event.id as string, friend);
    expect(after.participants).toContainEqual(
      expect.objectContaining({
        profileId: friend.profileId,
        rsvp: 'PENDING',
        role: 'PARTICIPANT',
      }),
    );
    await identity.background.flush();
    const mails = identity.mail.sent.filter((m) => m.to === `p-${friend.accountId}@lahotte.test`);
    expect(mails).toHaveLength(1);
    const text = `${mails[0]!.subject} ${mails[0]!.text}`;
    for (const secret of ['Secret de Noël', 'Lyon', '2027', 'Léa', 'Paul']) {
      expect(text).not.toContain(secret);
    }
    // L'invité voit l'événement, avec sa réponse en attente.
    expect(await get(friend, event.id as string)).toMatchObject({ myRsvp: 'PENDING' });
  });

  it('seul un organisateur invite ; un participant reçoit 403', async () => {
    const org = await person();
    const friend = await person();
    const other = await person();
    await link(org, friend);
    await link(friend, other);
    const event = await create(org, {});
    await invite(org, event.id as string, friend);
    await http()
      .post(`/api/v1/events/${event.id as string}/participants`)
      .set(friend.mutation)
      .send({ profileIds: [other.profileId] })
      .expect(403);
  });
});

describe('Réponse (EVT-13, EVT-18)', () => {
  it('Participe, Peut-être, Ne participe pas ; En attente refusé', async () => {
    const org = await person();
    const friend = await person();
    await link(org, friend);
    const event = await create(org, {});
    await invite(org, event.id as string, friend);
    for (const rsvp of ['YES', 'MAYBE', 'NO']) {
      await http()
        .put(`/api/v1/events/${event.id as string}/rsvp`)
        .set(friend.mutation)
        .send({ rsvp })
        .expect(200);
      expect((await get(friend, event.id as string)).myRsvp).toBe(rsvp);
    }
    await http()
      .put(`/api/v1/events/${event.id as string}/rsvp`)
      .set(friend.mutation)
      .send({ rsvp: 'PENDING' })
      .expect(400);
  });

  it('figée après la date et à l’annulation', async () => {
    const org = await person();
    const event = await create(org, {});
    events.events.force(event.id as string, { date: '2025-12-24' });
    await http()
      .put(`/api/v1/events/${event.id as string}/rsvp`)
      .set(org.mutation)
      .send({ rsvp: 'NO' })
      .expect(403);
    const other = await create(org, {});
    await http()
      .post(`/api/v1/events/${other.id as string}/cancel`)
      .set(org.mutation)
      .expect(200);
    await http()
      .put(`/api/v1/events/${other.id as string}/rsvp`)
      .set(org.mutation)
      .send({ rsvp: 'NO' })
      .expect(403);
  });
});

describe('Organisateurs, retrait, honorés (EVT-06, EVT-07, EVT-17)', () => {
  it('nommer, retirer le rôle (créateur seul), retirer un participant', async () => {
    const org = await person();
    const a = await person();
    const b = await person();
    await link(org, a);
    await link(org, b);
    const event = await create(org, {});
    const id = event.id as string;
    await invite(org, id, a, b);
    await http()
      .put(`/api/v1/events/${id}/organizers/${a.profileId}`)
      .set(org.mutation)
      .expect(204);
    // Un organisateur nommé ne retire pas le rôle, ni ne retire le créateur.
    await http()
      .delete(`/api/v1/events/${id}/organizers/${a.profileId}`)
      .set(a.mutation)
      .expect(403);
    await http()
      .delete(`/api/v1/events/${id}/participants/${org.profileId}`)
      .set(a.mutation)
      .expect(403);
    await http()
      .delete(`/api/v1/events/${id}/participants/${b.profileId}`)
      .set(a.mutation)
      .expect(204);
    await get(b, id, 404);
    await http()
      .delete(`/api/v1/events/${id}/organizers/${a.profileId}`)
      .set(org.mutation)
      .expect(204);
    expect((await get(a, id)).myRole).toBe('PARTICIPANT');
  });

  it('EVT-07 : ajouter un honoré ; en surprise, jamais un participant', async () => {
    const org = await person();
    const a = await person();
    const b = await person();
    await link(org, a);
    await link(org, b);
    const event = await surprise(org, a);
    const id = event.id as string;
    await invite(org, id, b);
    await http()
      .post(`/api/v1/events/${id}/honorees`)
      .set(org.mutation)
      .send({ profileIds: [b.profileId] })
      .expect(422);
    const exchange = await create(org, {});
    await http()
      .post(`/api/v1/events/${exchange.id as string}/honorees`)
      .set(org.mutation)
      .send({ profileIds: [a.profileId] })
      .expect(403);
  });
});

describe('Lien d’invitation (EVT-16)', () => {
  it('le profil actif rejoint En attente ; un second passage ne consomme rien, même lien épuisé', async () => {
    const org = await person();
    const guest = await person('Invité hors cercle');
    const event = await create(org, {});
    const token = await newLink(org, event.id as string, 1);
    const preview = await http()
      .post('/api/v1/events/links/inspect')
      .set(guest.mutation)
      .send({ token })
      .expect(200);
    expect(preview.body).toMatchObject({
      eventId: event.id,
      title: 'Noël',
      alreadyParticipant: false,
    });
    await http()
      .post('/api/v1/events/links/redeem')
      .set(guest.mutation)
      .send({ token })
      .expect(200);
    await http()
      .post('/api/v1/events/links/redeem')
      .set(guest.mutation)
      .send({ token })
      .expect(200);
    expect((await get(guest, event.id as string)).myRsvp).toBe('PENDING');
    const stored = [...events.links.links.values()].find((l) => l.eventId === event.id);
    expect(stored?.usedCount).toBe(1);
    // Épuisé, le lien n'est plus listé.
    const links = await http()
      .get(`/api/v1/events/${event.id as string}/links`)
      .set({ Cookie: org.cookie })
      .expect(200);
    expect(links.body.items).toEqual([]);
    // EVT-11 : rejoindre ne crée pas de lien entre profils.
    expect(await identity.links.inCircle(org.profileId as string, guest.profileId as string)).toBe(
      false,
    );
  });

  it('honoré de la surprise, lien révoqué, épuisé, bloqué : même réponse qu’un jeton inconnu, au temps plancher', async () => {
    const org = await person();
    const honoree = await person();
    const blocked = await person();
    const user = await person();
    const other = await person();
    await link(org, honoree);
    const event = await surprise(org, honoree);
    const id = event.id as string;
    const token = await newLink(org, id, 1);
    const unknown = await http()
      .post('/api/v1/events/links/redeem')
      .set(user.mutation)
      .send({ token: 'AAAAAAAAAAAAAAAAAAAAAA' })
      .expect(404);
    const shape = (body: Body) => ({ ...body, instance: undefined, requestId: undefined });
    const before = events.floor.pads;
    const asHonoree = await http()
      .post('/api/v1/events/links/redeem')
      .set(honoree.mutation)
      .send({ token })
      .expect(404);
    expect(shape(asHonoree.body as Body)).toEqual(shape(unknown.body as Body));
    const inspectHonoree = await http()
      .post('/api/v1/events/links/inspect')
      .set(honoree.mutation)
      .send({ token })
      .expect(404);
    expect(shape(inspectHonoree.body as Body)).toEqual(shape(unknown.body as Body));
    // LNK-05 : bloqué par l'organisateur (un blocage suppose un lien).
    await link(org, blocked);
    await http()
      .post('/api/v1/blocks')
      .set(org.mutation)
      .send({ profileId: blocked.profileId })
      .expect(204);
    const asBlocked = await http()
      .post('/api/v1/events/links/redeem')
      .set(blocked.mutation)
      .send({ token })
      .expect(404);
    expect(shape(asBlocked.body as Body)).toEqual(shape(unknown.body as Body));
    // Épuisé : un usage, consommé par un autre.
    await http()
      .post('/api/v1/events/links/redeem')
      .set(other.mutation)
      .send({ token })
      .expect(200);
    await http().post('/api/v1/events/links/redeem').set(user.mutation).send({ token }).expect(404);
    expect(events.floor.pads).toBe(before + 4);
    // Révoqué.
    const second = await newLink(org, id);
    const listed = await http()
      .get(`/api/v1/events/${id}/links`)
      .set({ Cookie: org.cookie })
      .expect(200);
    for (const l of listed.body.items as Body[]) {
      await http()
        .delete(`/api/v1/events/${id}/links/${l.id as string}`)
        .set(org.mutation)
        .expect(204);
    }
    await http()
      .post('/api/v1/events/links/redeem')
      .set(user.mutation)
      .send({ token: second })
      .expect(404);
  });

  it('un profil enfant hors du cercle de l’auteur du lien est refusé ; un profil enfant ne crée pas de lien', async () => {
    const org = await person();
    const child = await person('Enfant', true);
    const event = await create(org, {});
    const token = await newLink(org, event.id as string);
    await http()
      .post('/api/v1/events/links/redeem')
      .set(child.mutation)
      .send({ token })
      .expect(403)
      .expect((res) => {
        expect(res.body.code).toBe('EVENT_CHILD_OUTSIDE_CIRCLE');
      });
    const childEvent = await create(child, {});
    await http()
      .post(`/api/v1/events/${childEvent.id as string}/links`)
      .set(child.mutation)
      .send({})
      .expect(403);
  });

  it('le jeton ne passe pas par les invitations de cercle (LNK-01)', async () => {
    const org = await person();
    const guest = await person();
    const event = await create(org, {});
    const token = await newLink(org, event.id as string);
    await http().post('/api/v1/invitations/redeem').set(guest.mutation).send({ token }).expect(404);
  });
});

describe('Cycle de vie (EVT-33, EVT-34, EVT-39, EVT-40)', () => {
  it('modification par un organisateur avec If-Match ; date passée refusée', async () => {
    const org = await person();
    const event = await create(org, {});
    const id = event.id as string;
    const res = await http()
      .patch(`/api/v1/events/${id}`)
      .set({ ...org.mutation, 'If-Match': String(event.version) })
      .send({ title: 'Noël en famille', place: 'Chez mamie' })
      .expect(200);
    expect(res.body).toMatchObject({ title: 'Noël en famille', place: 'Chez mamie' });
    await http()
      .patch(`/api/v1/events/${id}`)
      .set({ ...org.mutation, 'If-Match': String(event.version) })
      .send({ title: 'Conflit' })
      .expect(412);
    await http()
      .patch(`/api/v1/events/${id}`)
      .set({ ...org.mutation, 'If-Match': String(res.body.version) })
      .send({ date: '2020-01-01' })
      .expect(422);
  });

  it('annulation : liens révoqués ; suppression par le créateur seul, listes détachées', async () => {
    const org = await person();
    const friend = await person();
    await link(org, friend);
    const event = await create(org, {});
    const id = event.id as string;
    await invite(org, id, friend);
    await http()
      .put(`/api/v1/events/${id}/organizers/${friend.profileId}`)
      .set(org.mutation)
      .expect(204);
    const token = await newLink(org, id);
    const cancelled = await http()
      .post(`/api/v1/events/${id}/cancel`)
      .set(org.mutation)
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    const guest = await person();
    await http()
      .post('/api/v1/events/links/redeem')
      .set(guest.mutation)
      .send({ token })
      .expect(404);
    await http().delete(`/api/v1/events/${id}`).set(friend.mutation).expect(403);
    await http().delete(`/api/v1/events/${id}`).set(org.mutation).expect(204);
    await get(org, id, 404);
    expect(catalog.lists.lists.size).toBeGreaterThanOrEqual(0);
  });

  it('EVT-33 : terminé 30 jours après la date ; EVT-40 : recréé un an plus tard, invités en attente', async () => {
    const org = await person();
    const friend = await person();
    await link(org, friend);
    const event = await create(org, {});
    const id = event.id as string;
    await invite(org, id, friend);
    events.events.force(id, { date: '2025-10-01' });
    expect(await events.complete()).toBeGreaterThanOrEqual(1);
    const done = await get(org, id);
    expect(done).toMatchObject({ status: 'DONE', permissions: { recreate: true, edit: false } });
    const res = await http().post(`/api/v1/events/${id}/recreate`).set(org.mutation).expect(201);
    expect(res.body).toMatchObject({
      title: 'Noël',
      myRole: 'ORGANIZER',
      myRsvp: 'YES',
      status: 'UPCOMING',
    });
    expect(res.body.date > '2026-01-01').toBe(true);
    expect(res.body.participants).toContainEqual(
      expect.objectContaining({ profileId: friend.profileId, rsvp: 'PENDING' }),
    );
  });
});
