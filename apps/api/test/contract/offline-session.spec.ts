import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TEST_PIN } from '../../src/modules/identity/infrastructure/in-memory';
import { PRESESSION_COOKIE, SESSION_COOKIE } from '../../src/modules/identity/presentation/cookies';
import { type SignedIn, WEB_ORIGIN } from '../support/sign-in';
import { createTestApp, type TestIdentity } from './create-test-app';

// OFF-26, OFF-28, OFF-30 (ADR 0020) : clé de cache d'un profil à PIN, étiquette du compte,
// appareil partagé.

let app: INestApplication;
let identity: TestIdentity;

beforeAll(async () => {
  ({ app, identity } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
});

const http = () => request(app.getHttpServer());
const OTHER_PIN = '9876';

function unlock(user: SignedIn, pin = TEST_PIN) {
  return http()
    .post('/api/v1/session/profile')
    .set(user.mutation)
    .send({ profileId: user.profileId, pin })
    .expect(200);
}

function cacheKey(user: SignedIn) {
  return http().get('/api/v1/profiles/me/cache-key').set({ Cookie: user.cookie });
}

describe('GET /profiles/me/cache-key (OFF-26)', () => {
  it('profil sans PIN : aucun chiffrement demandé, aucune clé', async () => {
    const user = await identity.signIn();
    const res = await cacheKey(user).expect(200);
    expect(res.body).toEqual({ encrypted: false, keyId: null, key: null });
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('profil à PIN : 423 tant qu’il est verrouillé ; clé stable une fois déverrouillé', async () => {
    const user = await identity.signIn({ pin: true });
    const locked = await cacheKey(user);
    expect({ status: locked.status, code: locked.body.code }).toEqual({
      status: 423,
      code: 'PROFILE_LOCKED',
    });
    await unlock(user);
    const first = await cacheKey(user).expect(200);
    expect(first.body.encrypted).toBe(true);
    expect(first.body.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.body.keyId).toMatch(/^[0-9a-f]{32}$/);
    expect(first.body.keyId).not.toContain(first.body.key);
    const again = await cacheKey(user).expect(200);
    expect(again.body).toEqual(first.body);
  });

  it('PIN changé : nouvelle clé et nouvel identifiant (l’ancien cache devient illisible)', async () => {
    const user = await identity.signIn({ pin: true });
    await unlock(user);
    const before = await cacheKey(user).expect(200);
    await http()
      .put('/api/v1/profiles/me/pin')
      .set(user.mutation)
      .send({ currentPin: TEST_PIN, newPin: OTHER_PIN })
      .expect(204);
    await unlock(user, OTHER_PIN);
    const after = await cacheKey(user).expect(200);
    expect(after.body.encrypted).toBe(true);
    expect(after.body.key).not.toBe(before.body.key);
    expect(after.body.keyId).not.toBe(before.body.keyId);
  });

  it('deux profils à PIN identique n’ont jamais la même clé', async () => {
    const a = await identity.signIn({ pin: true });
    const b = await identity.signIn({ pin: true });
    await unlock(a);
    await unlock(b);
    const ka = await cacheKey(a).expect(200);
    const kb = await cacheKey(b).expect(200);
    expect(ka.body.key).not.toBe(kb.body.key);
  });
});

describe('GET /session : étiquette du compte et appareil partagé (OFF-28, OFF-30)', () => {
  it('étiquette opaque, stable, propre au compte ; appareil ordinaire par défaut', async () => {
    const a = await identity.signIn();
    const b = await identity.signIn();
    const read = async (u: SignedIn) =>
      (await http().get('/api/v1/session').set({ Cookie: u.cookie }).expect(200)).body.session as {
        accountTag: string;
        sharedDevice: boolean;
      };
    const sa = await read(a);
    expect(sa.sharedDevice).toBe(false);
    expect(sa.accountTag).toMatch(/^[0-9a-f]{32}$/);
    expect(sa.accountTag).not.toContain(a.accountId.replace(/-/g, ''));
    expect((await read(a)).accountTag).toBe(sa.accountTag);
    expect((await read(b)).accountTag).not.toBe(sa.accountTag);
  });

  it('connexion « appareil partagé » : session de 2 heures, marquée, sans appareil de confiance', async () => {
    const address = `partage-${Date.now()}@lahotte.test`;
    const password = 'une phrase de passe assez longue';
    const pre = await http().get('/api/v1/session').expect(200);
    const presessionCookie = (pre.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))
      ?.split(';')[0];
    const headers = {
      Cookie: presessionCookie ?? '',
      'X-CSRF-Token': pre.body.csrfToken as string,
      Origin: WEB_ORIGIN,
    };
    await http()
      .post('/api/v1/auth/register')
      .set(headers)
      .send({ email: address, password, displayName: 'Camille', ageAttested: true })
      .expect(202);
    await identity.background.flush();
    await http()
      .post('/api/v1/auth/email/verify')
      .set(headers)
      .send({ token: identity.mail.lastToken(address) })
      .expect(204);
    const before = Date.now();
    const res = await http()
      .post('/api/v1/auth/login')
      .set(headers)
      .send({ email: address, password, sharedDevice: true })
      .expect(200);
    expect(res.body.session.sharedDevice).toBe(true);
    const expires = new Date(res.body.session.expiresAt as string).getTime();
    expect(expires - before).toBeLessThanOrEqual(2 * 60 * 60 * 1000 + 5_000);
    expect(expires - before).toBeGreaterThan(2 * 60 * 60 * 1000 - 60_000);
    const row = identity.sessions.rows.get(res.body.session.id as string);
    expect(row?.sharedDevice).toBe(true);
    expect(row?.trustedDeviceId).toBeNull();
    expect(row && row.absoluteExpiresAt.getTime() - before).toBeLessThanOrEqual(
      12 * 60 * 60 * 1000 + 5_000,
    );
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${SESSION_COOKIE}=`),
    );
    expect(cookie).toBeDefined();
  });
});
