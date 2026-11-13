import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CsrfTokens } from '../../src/modules/identity/domain/ports';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import {
  CSRF_COOKIE,
  PRESESSION_COOKIE,
  SESSION_COOKIE,
} from '../../src/modules/identity/presentation/cookies';
import type { InMemoryExampleItemRepository } from '../../src/modules/example';
import { createTestApp, type TestIdentity } from './create-test-app';
import { IdentityTestRoutesController } from './identity-test-routes.controller';
import { listRoutes } from './routes';
import { session, unlockProfile, WEB_ORIGIN } from '../support/sign-in';

// Chaîne de gardes, CSRF, `GET /session`, profil actif (ADR 0013, API-21, SEC-01, PIN-02, PIN-07).

let app: INestApplication;
let identity: TestIdentity;
let exampleItems: InMemoryExampleItemRepository;

beforeAll(async () => {
  ({ app, identity, exampleItems } = await createTestApp({
    controllers: [IdentityTestRoutesController],
  }));
});

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());
const MINUTE = 60_000;

/** Routes publiques : liste explicite (SEC-01). Toute nouvelle route publique s'ajoute ici, en revue. */
const PUBLIC_ROUTES = [
  'GET /api/v1/session',
  'GET /health/live',
  'GET /health/ready',
  // Avant session (ADR 0013, « CSRF » : jeton de pré-session).
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  // Second facteur : pré-authentification (`__Host-lh_pending`), pas encore de session (AUTH-12).
  'POST /api/v1/auth/totp/verify',
  'POST /api/v1/auth/email/verify',
  'POST /api/v1/auth/email/cancel',
  'POST /api/v1/auth/password/reset',
  'POST /api/v1/auth/password/reset/confirm',
];
/** Seul `GET` autorisé à modifier l'état (API-21). */
const OIDC_CALLBACK_ROUTES = ['GET /api/v1/auth/google/callback'];

function cookiesOf(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : [];
}

describe('Marques de route (ADR 0013)', () => {
  it('SEC-01 : chaque route porte exactement une marque d’accès', () => {
    const routes = listRoutes(app);
    expect(routes.length).toBeGreaterThan(5);
    const wrong = routes
      .filter((route) => route.marks.length !== 1)
      .map((route) => `${route.method} ${route.path} : ${route.marks.join(', ') || 'aucune'}`);
    expect(wrong).toEqual([]);
  });

  it('SEC-01 : les routes publiques sont exactement la liste explicite', () => {
    const publicRoutes = listRoutes(app)
      .filter((route) => route.marks.includes('public'))
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(publicRoutes).toEqual([...PUBLIC_ROUTES].sort());
  });

  it('API-21 : la marque OIDC (seul GET autorisé à modifier l’état) ne va qu’au retour Google', () => {
    const marked = listRoutes(app)
      .filter((route) => route.oidcCallback)
      .map((route) => `${route.method} ${route.path}`);
    for (const route of marked) expect(OIDC_CALLBACK_ROUTES).toContain(route);
  });

  it('API-21 : aucun GET ne modifie l’état (sessions, marques, profil, journal, e-mails)', async () => {
    const user = await identity.signIn({ pin: true });
    await unlockProfile(app, user, new Date());
    const { sessions, securityLog, mail } = identity;
    // Seule l'activité (`lastSeenAt`, `expiresAt`, recopie) peut bouger : c'est l'expiration
    // glissante de l'ADR 0013, pas un changement d'état.
    const snapshot = (): string =>
      JSON.stringify({
        rows: [...sessions.rows.values()].map(({ lastSeenAt: _l, expiresAt: _e, ...row }) => row),
        cache: [...sessions.cache.entries()].map(([hash, cached]) => {
          const { lastSeenAt: _l, expiresAt: _e, ...record } = cached.record;
          return [hash, record, cached.unlock];
        }),
        marks: [...sessions.revokedMarks],
        epochs: [...sessions.cachedEpochs],
        log: securityLog.entries.length,
        mail: mail.sent.length,
        // Autres modules : leurs dépôts en mémoire (aujourd'hui, le module type).
        exampleItems: exampleItems.size,
      });
    const uuid = '0190f3c2-0000-7000-8000-000000000001';
    // Santé exclue : sans base en test de contrat, et sans lien avec l'état de session.
    const gets = listRoutes(app).filter(
      (route) => route.method === 'GET' && !route.oidcCallback && !route.path.startsWith('/health'),
    );
    expect(gets.length).toBeGreaterThan(3);
    // Avec X-User-Activity, seul l'instant du déverrouillage peut avancer (PIN-07).
    const withoutUnlockTime = (): string => snapshot().replace(/"at":"[^"]*"/g, '"at":"-"');
    for (const route of gets) {
      const path = route.path.replace(/:[A-Za-z]+/g, uuid);
      const before = snapshot();
      await http().get(path).set('Cookie', user.cookie);
      expect({ route: route.path, changed: snapshot() !== before }).toEqual({
        route: route.path,
        changed: false,
      });
      const beforeActivity = withoutUnlockTime();
      await http().get(path).set('Cookie', user.cookie).set('X-User-Activity', '1');
      expect({ route: route.path, changed: withoutUnlockTime() !== beforeActivity }).toEqual({
        route: route.path,
        changed: false,
      });
    }
  });

  it('critère de 09 : toute route sans session est refusée, hors liste publique', async () => {
    const uuid = '0190f3c2-0000-7000-8000-000000000001';
    for (const route of listRoutes(app)) {
      const key = `${route.method} ${route.path}`;
      if (PUBLIC_ROUTES.includes(key)) continue;
      const path = route.path.replace(/:[A-Za-z]+/g, uuid);
      const call = http()
        [route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](path)
        .set('Origin', WEB_ORIGIN);
      const res = await call;
      expect({ route: key, status: res.status }).toEqual({ route: key, status: 401 });
    }
  });
});

describe('GET /api/v1/session (API-21)', () => {
  it('sans session : pré-session HttpOnly, jeton CSRF lisible, no-store', async () => {
    const res = await http().get('/api/v1/session').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      authenticated: false,
      csrfToken: expect.any(String),
      session: null,
      secondFactorPending: false,
    });
    const cookies = cookiesOf(res);
    const presession = cookies.find((c) => c.startsWith(`${PRESESSION_COOKIE}=`));
    const csrf = cookies.find((c) => c.startsWith(`${CSRF_COOKIE}=`));
    expect(presession).toMatch(/HttpOnly/);
    expect(presession).toMatch(/Secure/);
    expect(presession).toMatch(/SameSite=Lax/);
    expect(presession).toMatch(/Path=\//);
    expect(presession).not.toMatch(/Domain=/);
    expect(csrf).not.toMatch(/HttpOnly/);
    expect(csrf).toContain(encodeURIComponent(res.body.csrfToken as string));
  });

  it('avec session : identifiant exposé, jamais le jeton ni son hash ; ne prolonge pas le déverrouillage', async () => {
    const user = await identity.signIn({ pin: true });
    const unlockedAt = new Date(Date.now() - 5 * MINUTE);
    await unlockProfile(app, user, unlockedAt);

    const res = await http()
      .get('/api/v1/session')
      .set('Cookie', user.cookie)
      .set('X-User-Activity', '1')
      .expect(200);
    expect(res.body).toEqual({
      authenticated: true,
      csrfToken: user.csrf,
      session: {
        id: user.sessionId,
        activeProfileId: user.profileId,
        profileUnlocked: true,
        expiresAt: expect.any(String),
      },
      secondFactorPending: false,
    });
    expect(res.text).not.toContain(user.token);
    expect(res.text).not.toContain(user.tokenHash);
    expect(identity.sessions.cache.get(user.tokenHash)?.unlock?.at).toEqual(unlockedAt);
  });

  it('jeton de session inconnu : traité comme sans session, cookie retiré', async () => {
    const res = await http()
      .get('/api/v1/session')
      .set('Cookie', `${SESSION_COOKIE}=${'a'.repeat(43)}`)
      .expect(200);
    expect(res.body.authenticated).toBe(false);
    expect(cookiesOf(res).some((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
  });
});

describe('CSRF (API-21, ADR 0013)', () => {
  it('mutation légitime acceptée (Origin, puis Sec-Fetch-Site)', async () => {
    const user = await identity.signIn();
    await http().post('/api/v1/_identity-test/profile').set(user.mutation).expect(204);
    await http()
      .post('/api/v1/_identity-test/profile')
      .set({ Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Sec-Fetch-Site': 'same-origin' })
      .expect(204);
  });

  it('jeton absent : 403 CSRF_REJECTED, inscrit au journal de sécurité', async () => {
    const user = await identity.signIn();
    const res = await http()
      .post('/api/v1/_identity-test/profile')
      .set({ Cookie: user.cookie, Origin: WEB_ORIGIN })
      .expect(403);
    expect(res.body).toMatchObject({ code: 'CSRF_REJECTED' });
    expect(identity.securityLog.entries.at(-1)).toMatchObject({
      event: 'csrf.rejected',
      accountId: user.accountId,
    });
  });

  it('origine étrangère refusée, même avec le bon jeton', async () => {
    const user = await identity.signIn();
    await http()
      .post('/api/v1/_identity-test/profile')
      .set({ ...user.mutation, Origin: 'https://evil.example' })
      .expect(403);
    await http()
      .post('/api/v1/_identity-test/profile')
      .set({ ...user.mutation, 'Sec-Fetch-Site': 'cross-site' })
      .expect(403);
    await http()
      .post('/api/v1/_identity-test/profile')
      .set({ Cookie: user.cookie, 'X-CSRF-Token': user.csrf })
      .expect(403);
  });

  it('jeton d’une autre session refusé', async () => {
    const user = await identity.signIn();
    const other = await identity.signIn();
    await http()
      .post('/api/v1/_identity-test/profile')
      .set({ ...user.mutation, 'X-CSRF-Token': other.csrf })
      .expect(403);
  });

  it('jeton de pré-session refusé sur une route qui exige une session', async () => {
    const user = await identity.signIn();
    const pre = await http().get('/api/v1/session').expect(200);
    const presession = cookiesOf(pre)
      .find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))
      ?.split(';')[0];
    await http()
      .post('/api/v1/_identity-test/profile')
      .set({
        Cookie: `${user.cookie}; ${presession ?? ''}`,
        'X-CSRF-Token': pre.body.csrfToken as string,
        Origin: WEB_ORIGIN,
      })
      .expect(403);
  });

  it('rotation : le jeton CSRF d’avant rotation est refusé, l’ancien jeton de session aussi', async () => {
    const user = await identity.signIn();
    const rotated = await app.get(SessionLifecycle).rotate({
      id: user.sessionId,
      accountId: user.accountId,
      tokenHash: user.tokenHash,
    });
    const fresh = session(
      app,
      rotated.token,
      rotated.record.tokenHash,
      user.sessionId,
      user.accountId,
      user.profileId,
    );
    expect(fresh.csrf).not.toBe(user.csrf);
    expect(app.get(CsrfTokens).forSession(rotated.record.tokenHash)).toBe(fresh.csrf);

    await http()
      .post('/api/v1/_identity-test/profile')
      .set({ ...fresh.mutation, 'X-CSRF-Token': user.csrf })
      .expect(403);
    // Critère de 01 : jeton remplacé par une ré-authentification refusé à la requête suivante.
    await http().get('/api/v1/_identity-test/profile').set('Cookie', user.cookie).expect(401);
    await http().post('/api/v1/_identity-test/profile').set(fresh.mutation).expect(204);
  });
});

describe('Profil actif (PIN-02, PIN-07)', () => {
  it('compte sans profil actif : 423 sur une route de profil, 200 sur l’espace Compte', async () => {
    const user = await identity.signIn({ withProfile: false });
    await http().get('/api/v1/_identity-test/profile').set('Cookie', user.cookie).expect(423);
    await http().get('/api/v1/_identity-test/account').set('Cookie', user.cookie).expect(200);
  });

  it('PIN-07 : déverrouillage expiré après 15 minutes sans action', async () => {
    const user = await identity.signIn({ pin: true });
    await unlockProfile(app, user, new Date(Date.now() - 16 * MINUTE));
    await http().get('/api/v1/_identity-test/profile').set('Cookie', user.cookie).expect(423);
  });

  it('PIN-07 : le trafic automatique (sans X-User-Activity) ne prolonge pas le déverrouillage', async () => {
    const user = await identity.signIn({ pin: true });
    const unlockedAt = new Date(Date.now() - 14 * MINUTE);
    await unlockProfile(app, user, unlockedAt);

    await http().get('/api/v1/_identity-test/profile').set('Cookie', user.cookie).expect(200);
    expect(identity.sessions.cache.get(user.tokenHash)?.unlock?.at).toEqual(unlockedAt);

    await http()
      .get('/api/v1/_identity-test/profile')
      .set('Cookie', user.cookie)
      .set('X-User-Activity', '1')
      .expect(200);
    const refreshed = identity.sessions.cache.get(user.tokenHash)?.unlock?.at;
    expect(refreshed?.getTime()).toBeGreaterThan(unlockedAt.getTime());
  });

  it('ADR 0013 : une session réhydratée depuis la base garde son profil, verrouillé', async () => {
    const user = await identity.signIn({ pin: true });
    await unlockProfile(app, user, new Date());
    await http().get('/api/v1/_identity-test/profile').set('Cookie', user.cookie).expect(200);

    identity.sessions.dropCache();
    await http().get('/api/v1/_identity-test/profile').set('Cookie', user.cookie).expect(423);
    const status = await http().get('/api/v1/session').set('Cookie', user.cookie).expect(200);
    expect(status.body.session).toMatchObject({
      activeProfileId: user.profileId,
      profileUnlocked: false,
    });
  });

  it('PIN-07 : changer de profil reverrouille', async () => {
    const user = await identity.signIn({ pin: true });
    await unlockProfile(app, user, new Date());
    await app
      .get(SessionLifecycle)
      .selectProfile(
        { id: user.sessionId, accountId: user.accountId, tokenHash: user.tokenHash },
        user.profileId,
      );
    await http().get('/api/v1/_identity-test/profile').set('Cookie', user.cookie).expect(423);
  });

  it('SEC-03 : un profil d’un autre compte n’est jamais un profil actif', async () => {
    const user = await identity.signIn();
    const other = await identity.signIn();
    await app
      .get(SessionLifecycle)
      .selectProfile(
        { id: user.sessionId, accountId: user.accountId, tokenHash: user.tokenHash },
        other.profileId,
      );
    await http().get('/api/v1/_identity-test/profile').set('Cookie', user.cookie).expect(423);
  });
});

describe('Ré-authentification (AUTH-14)', () => {
  it('sans ré-authentification récente : 401 REAUTH_REQUIRED ; après rotation : accepté', async () => {
    const user = await identity.signIn();
    const res = await http().post('/api/v1/_identity-test/reauth').set(user.mutation).expect(401);
    expect(res.body).toMatchObject({ code: 'REAUTH_REQUIRED' });

    const rotated = await app.get(SessionLifecycle).rotate({
      id: user.sessionId,
      accountId: user.accountId,
      tokenHash: user.tokenHash,
    });
    const fresh = session(
      app,
      rotated.token,
      rotated.record.tokenHash,
      user.sessionId,
      user.accountId,
      null,
    );
    await http().post('/api/v1/_identity-test/reauth').set(fresh.mutation).expect(204);
  });
});

describe('Révocation et époque (AUTH-05, ADR 0013)', () => {
  it('session révoquée refusée à la requête suivante, événement publié', async () => {
    const user = await identity.signIn();
    const events: string[] = [];
    const { IdentityEvents } = await import('../../src/modules/identity');
    const unsubscribe = app.get(IdentityEvents).subscribe((event) => events.push(event.type));
    await app
      .get(SessionLifecycle)
      .revoke({ id: user.sessionId, accountId: user.accountId, tokenHash: user.tokenHash });
    unsubscribe();
    expect(events).toEqual(['session.revoked']);
    await http().get('/api/v1/_identity-test/account').set('Cookie', user.cookie).expect(401);
  });

  it('époque du compte augmentée : toutes ses sessions refusées, une nouvelle est possible', async () => {
    const user = await identity.signIn();
    await identity.sessions.beginEpochChange(user.accountId);
    await http().get('/api/v1/_identity-test/account').set('Cookie', user.cookie).expect(401);
    expect(identity.sessions.rows.has(user.sessionId)).toBe(false);

    const { signIn } = await import('../support/sign-in');
    const again = await signIn(app, { accountId: user.accountId });
    await http().get('/api/v1/_identity-test/account').set('Cookie', again.cookie).expect(200);
  });
});

describe('Cache-Control (ADR 0013)', () => {
  it('revue SEC-40 M8 : no-store sur toute réponse faite à une session, compte comme profil', async () => {
    const user = await identity.signIn();
    for (const path of ['/api/v1/_identity-test/account', '/api/v1/_identity-test/profile']) {
      const res = await http().get(path).set('Cookie', user.cookie).expect(200);
      expect({ path, cache: res.headers['cache-control'] }).toEqual({ path, cache: 'no-store' });
    }
    const pub = await http().get('/health/live').expect(200);
    expect(pub.headers['cache-control']).not.toBe('no-store');
  });

  it('ADR 0013 : no-store par chemin pour les routes publiques de session et d’authentification', async () => {
    const { isNoStorePath } = await import('../../src/bootstrap');
    for (const path of [
      '/api/v1/session',
      '/api/v1/sessions',
      '/api/v1/sessions/abc',
      '/api/v1/auth/login',
      '/api/v1/account',
      '/api/v1/account/profiles',
      '/api/v1/trusted-devices',
      '/api/v1/profiles/me',
      '/api/v1/profiles/me/export',
      '/api/v1/Session/',
    ]) {
      expect({ path, noStore: isNoStorePath(path) }).toEqual({ path, noStore: true });
    }
    for (const path of ['/api/v1/sessionsx', '/api/v1/profiles/meta', '/api/v1/lists']) {
      expect({ path, noStore: isNoStorePath(path) }).toEqual({ path, noStore: false });
    }
  });
});
