import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import { createTestApp, type TestEvents, type TestIdentity } from './create-test-app';
import { PHASE3_IDOR_ROUTES } from './idor-routes';

// SEC-03, VIS-34, EVT-08 : IDOR sur toutes les routes à identifiant des événements, jouées par un
// inconnu et par l'honoré de la surprise (EVT-04 : pas même l'existence).

let app: INestApplication;
let identity: TestIdentity;
let events: TestEvents;

beforeAll(async () => {
  ({ app, identity, events } = await createTestApp());
});

afterAll(async () => {
  await app.close();
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

describe('IDOR sur les événements (SEC-03, EVT-08)', () => {
  it('chaque route répond comme pour un identifiant inconnu, sans rien écrire', async () => {
    identity.rateLimiter.reset();
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
    const eventId = created.body.id as string;
    await http()
      .post(`/api/v1/events/${eventId}/participants`)
      .set(org.mutation)
      .send({ profileIds: [friend.profileId] })
      .expect(200);
    const link1 = await http().post(`/api/v1/events/${eventId}/links`).set(org.mutation).send({});
    const linkId = link1.body.link.id as string;
    // EVT-29 : giftlist secrète de la surprise, rattachée dès la création.
    const gift = await http()
      .post('/api/v1/lists')
      .set(org.mutation)
      .send({
        type: 'GIFTLIST',
        title: 'Cadeau commun',
        recipientIds: [honoree.profileId],
        eventId,
        audience: 'EVENT',
      })
      .expect(201);
    const giftListId = gift.body.id as string;

    const table: {
      route: string;
      body?: object;
      headers?: Record<string, string>;
      query?: string;
    }[] = [
      { route: 'GET /api/v1/events/:id' },
      { route: 'PATCH /api/v1/events/:id', body: { title: 'x' }, headers: { 'If-Match': '1' } },
      { route: 'DELETE /api/v1/events/:id' },
      { route: 'POST /api/v1/events/:id/cancel' },
      { route: 'POST /api/v1/events/:id/recreate' },
      { route: 'GET /api/v1/events/:id/participants' },
      { route: 'POST /api/v1/events/:id/participants', body: { profileIds: [friend.profileId] } },
      { route: 'POST /api/v1/events/:id/honorees', body: { profileIds: [friend.profileId] } },
      { route: 'PUT /api/v1/events/:id/rsvp', body: { rsvp: 'YES' } },
      { route: 'GET /api/v1/events/:id/links' },
      { route: 'POST /api/v1/events/:id/links', body: {} },
      { route: 'GET /api/v1/events/:id/carry-over' },
      {
        route: 'POST /api/v1/events/:id/carry-over',
        body: { listId: giftListId, itemIds: [randomUUID()] },
      },
      { route: 'GET /api/v1/events/:id/ideas', query: '?q=velo' },
    ];
    const withSecond: { route: string; second: string }[] = [
      {
        route: 'DELETE /api/v1/events/:id/participants/:profileId',
        second: friend.profileId as string,
      },
      { route: 'PUT /api/v1/events/:id/organizers/:profileId', second: friend.profileId as string },
      { route: 'DELETE /api/v1/events/:id/organizers/:profileId', second: org.profileId as string },
      { route: 'DELETE /api/v1/events/:id/links/:linkId', second: linkId },
    ];

    // Routes de liste : jouées sur la giftlist, l'identifiant inconnu étant une liste.
    const listTable: { route: string; body?: object }[] = [
      { route: 'PUT /api/v1/lists/:id/event', body: { eventId } },
      { route: 'DELETE /api/v1/lists/:id/event' },
    ];

    const stranger = await person();
    const snapshot = () => JSON.stringify([...events.events.events.values()]);
    const linkState = () => JSON.stringify([...events.links.links.values()]);
    const before = [snapshot(), linkState()];
    for (const attacker of [stranger, honoree]) {
      const send = (
        route: string,
        path: string,
        body?: object,
        headers?: Record<string, string>,
      ) => {
        const method = route.split(' ')[0]!.toLowerCase() as Method;
        const req = http()[method](path);
        return method === 'get'
          ? req.set({ Cookie: attacker.cookie })
          : req.set({ ...attacker.mutation, ...(headers ?? {}) }).send(body ?? {});
      };
      for (const row of table) {
        const template = row.route.split(' ')[1]!;
        const victim = await send(
          row.route,
          template.replace(':id', eventId) + (row.query ?? ''),
          row.body,
          row.headers,
        );
        const unknown = await send(
          row.route,
          template.replace(':id', randomUUID()) + (row.query ?? ''),
          row.body,
          row.headers,
        );
        expect({
          key: row.route,
          status: victim.status,
          code: victim.body.code as unknown,
        }).toEqual({
          key: row.route,
          status: 404,
          code: unknown.body.code as unknown,
        });
      }
      for (const row of listTable) {
        const template = row.route.split(' ')[1]!;
        const victim = await send(row.route, template.replace(':id', giftListId), row.body);
        const unknown = await send(row.route, template.replace(':id', randomUUID()), row.body);
        expect({
          key: row.route,
          status: victim.status,
          code: victim.body.code as unknown,
        }).toEqual({
          key: row.route,
          status: 404,
          code: unknown.body.code as unknown,
        });
      }
      for (const row of withSecond) {
        const template = row.route.split(' ')[1]!;
        const path = (id: string) =>
          template.replace(':id', id).replace(/:(profileId|linkId)/, row.second);
        const victim = await send(row.route, path(eventId));
        const unknown = await send(row.route, path(randomUUID()));
        expect({
          key: row.route,
          status: victim.status,
          code: victim.body.code as unknown,
        }).toEqual({
          key: row.route,
          status: 404,
          code: unknown.body.code as unknown,
        });
      }
    }
    expect([snapshot(), linkState()]).toEqual(before);
    const covered = new Set([
      ...table.map((r) => r.route),
      ...withSecond.map((r) => r.route),
      ...listTable.map((r) => r.route),
    ]);
    expect(PHASE3_IDOR_ROUTES.filter((route) => !covered.has(route))).toEqual([]);
  });
});
