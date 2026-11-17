import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PLATFORM_PERMISSIONS } from '../../src/modules/identity/application/contract';
import { hasPlatformPermission } from '../../src/modules/identity/domain/platform-permissions';
import type { AccountRole } from '../../src/modules/identity/domain/session';
import type { SignedIn } from '../support/sign-in';
import { createTestApp, type TestAdmin, type TestIdentity } from './create-test-app';
import { listRoutes, type RouteInfo } from './routes';

// Espace d'administration : critère d'acceptation de `11` (toutes les routes `/admin` parcourues
// avec un compte `USER` et un compte `MODERATOR`), RBAC-02, RBAC-04, RBAC-05, AUD-04, AUD-05.

const UUID = '01890000-0000-7000-8000-000000000000';

let app: INestApplication;
let identity: TestIdentity;
let admin: TestAdmin;

beforeAll(async () => {
  ({ app, identity, admin } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
});

const adminRoutes = (): RouteInfo[] =>
  listRoutes(app).filter((route) => route.path.startsWith('/api/v1/admin'));

function call(route: RouteInfo, user: SignedIn) {
  const path = route.path.replace(/:[A-Za-z]+/g, UUID);
  const verb = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  const req = request(app.getHttpServer())[verb](path);
  return route.method === 'GET' ? req.set('Cookie', user.cookie) : req.set(user.mutation);
}

/** Corps d'une réponse sans ce qui varie d'une requête à l'autre. */
function shape(body: Record<string, unknown>): Record<string, unknown> {
  const { requestId: _r, instance: _i, ...rest } = body;
  return rest;
}

async function unknownRoute(user: SignedIn): Promise<{ status: number; body: unknown }> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/admin/route-inconnue')
    .set('Cookie', user.cookie);
  return { status: res.status, body: shape(res.body as Record<string, unknown>) };
}

describe('Marques de l’espace d’administration (RBAC-04, RBAC-05)', () => {
  it('toute route /admin porte @AdminScope avec une permission connue, et elle seule', () => {
    const routes = adminRoutes();
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect({ route: route.path, marks: route.marks }).toEqual({
        route: route.path,
        marks: ['admin'],
      });
      expect(PLATFORM_PERMISSIONS).toContain(route.permission);
    }
    const elsewhere = listRoutes(app).filter(
      (route) => !route.path.startsWith('/api/v1/admin') && route.marks.includes('admin'),
    );
    expect(elsewhere).toEqual([]);
  });
});

describe('Refus comme une route inconnue (RBAC-02, RBAC-05, SEC-04)', () => {
  for (const role of ['USER', 'MODERATOR'] as const satisfies readonly AccountRole[]) {
    it(`${role} : 404 identique à une route inconnue là où RBAC-02 refuse, sur toutes les routes`, async () => {
      const user = await identity.signIn({ role });
      const reference = await unknownRoute(user);
      expect(reference.status).toBe(404);
      for (const route of adminRoutes()) {
        const allowed = hasPlatformPermission(role, route.permission as never);
        const res = await call(route, user);
        const key = `${role} ${route.method} ${route.path}`;
        if (allowed) {
          expect({ key, status: res.status }).not.toEqual({ key, status: 404 });
        } else {
          expect({
            key,
            status: res.status,
            body: shape(res.body as Record<string, unknown>),
          }).toEqual({
            key,
            ...reference,
          });
        }
      }
    });
  }

  it('ADMIN : aucune route /admin ne lui répond 404 de refus', async () => {
    const user = await identity.signIn({ role: 'ADMIN' });
    for (const route of adminRoutes()) {
      const res = await call(route, user);
      expect({ route: route.path, status: res.status }).not.toEqual({
        route: route.path,
        status: 404,
      });
    }
  });

  it('sans session : 401, comme tout l’espace connecté (SEC-01)', async () => {
    for (const route of adminRoutes()) {
      const path = route.path.replace(/:[A-Za-z]+/g, UUID);
      const verb = route.method.toLowerCase() as 'get';
      const res = await request(app.getHttpServer())[verb](path);
      expect({ route: route.path, status: res.status }).toEqual({ route: route.path, status: 401 });
    }
  });

  it('un rôle retiré prend effet à la requête suivante (RBAC-05)', async () => {
    const user = await identity.signIn({ role: 'ADMIN' });
    await request(app.getHttpServer())
      .get('/api/v1/admin/audit')
      .set('Cookie', user.cookie)
      .expect(200);
    const account = identity.sessions.accounts.get(user.accountId);
    if (!account) throw new Error('compte absent');
    identity.sessions.accounts.set(user.accountId, { ...account, role: 'USER' });
    await request(app.getHttpServer())
      .get('/api/v1/admin/audit')
      .set('Cookie', user.cookie)
      .expect(404);
  });

  it('un compte suspendu n’entre pas, même avec une session encore en cache', async () => {
    const user = await identity.signIn({ role: 'ADMIN' });
    const account = identity.sessions.accounts.get(user.accountId);
    if (!account) throw new Error('compte absent');
    identity.sessions.accounts.set(user.accountId, { ...account, active: false });
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/audit')
      .set('Cookie', user.cookie);
    expect([401, 404]).toContain(res.status);
  });
});

describe('Journal d’audit (AUD-04, AUD-05, AUD-06)', () => {
  it('consulter le journal est journalisé, sans contenu', async () => {
    const user = await identity.signIn({ role: 'ADMIN' });
    await request(app.getHttpServer())
      .get('/api/v1/admin/audit')
      .set('Cookie', user.cookie)
      .expect(200);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/audit?actorAccountId=${user.accountId}&action=audit.read`)
      .set('Cookie', user.cookie)
      .expect(200);
    const items = (res.body as { items: Array<Record<string, unknown>> }).items;
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({
      actorAccountId: user.accountId,
      action: 'audit.read',
      targetKind: null,
      targetId: null,
      reason: null,
      before: null,
      after: null,
    });
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(
      [
        'action',
        'actorAccountId',
        'after',
        'at',
        'before',
        'id',
        'ip',
        'reason',
        'targetId',
        'targetKind',
      ].sort(),
    );
  });

  it('pagination par curseur, 50 au plus', async () => {
    const user = await identity.signIn({ role: 'ADMIN' });
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .get('/api/v1/admin/audit?limit=1')
        .set('Cookie', user.cookie)
        .expect(200);
    }
    const first = await request(app.getHttpServer())
      .get(`/api/v1/admin/audit?actorAccountId=${user.accountId}&limit=2`)
      .set('Cookie', user.cookie)
      .expect(200);
    const page = first.body as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const next = await request(app.getHttpServer())
      .get(`/api/v1/admin/audit?actorAccountId=${user.accountId}&limit=2&cursor=${page.nextCursor}`)
      .set('Cookie', user.cookie)
      .expect(200);
    const ids = (next.body as { items: Array<{ id: string }> }).items.map((r) => r.id);
    expect(ids).not.toContain(page.items[0]?.id);
    await request(app.getHttpServer())
      .get('/api/v1/admin/audit?limit=51')
      .set('Cookie', user.cookie)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/admin/audit?cursor=xyz')
      .set('Cookie', user.cookie)
      .expect(422);
  });

  it('si l’écriture d’audit échoue, rien n’est lu (AUD-05)', async () => {
    const user = await identity.signIn({ role: 'ADMIN' });
    admin.audit.failNext = true;
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/audit')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty('items');
  });
});
