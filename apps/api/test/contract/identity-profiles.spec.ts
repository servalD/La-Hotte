import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { UNLOCK_COOKIE } from '../../src/modules/identity/presentation/cookies';
import { TEST_PIN } from '../../src/modules/identity/testing';
import { session, type SignedIn, WEB_ORIGIN } from '../support/sign-in';
import { createTestApp, type TestIdentity } from './create-test-app';
import { IdentityTestRoutesController } from './identity-test-routes.controller';

// Profils et PIN (PRO-01 à PRO-08, PIN-01 à PIN-08, AUTH-14, ADR 0013).

let app: INestApplication;
let identity: TestIdentity;

beforeAll(async () => {
  ({ app, identity } = await createTestApp({ controllers: [IdentityTestRoutesController] }));
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
});

const http = () => request(app.getHttpServer());
const MINUTE = 60_000;
const OTHER_PIN = '987654';

function cookiesOf(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : [];
}

/** Valeur du dernier `Set-Cookie` d'un nom (vide si effacé), `null` s'il n'est pas posé. */
function lastCookie(res: request.Response, name: string): string | null {
  const line = cookiesOf(res)
    .filter((c) => c.startsWith(`${name}=`))
    .at(-1);
  return line === undefined ? null : (line.split(';')[0]?.slice(name.length + 1) ?? '');
}

/** Compte vérifié en base mémoire, avec un premier profil (et sa session, profil actif). */
async function account(
  options: { pin?: boolean; relock?: 'NEVER' | 'IDLE_15' | 'EVERY_OPEN' } = {},
) {
  const user = await identity.signIn(options);
  identity.accounts.seed({ id: user.accountId, email: `p-${user.accountId}@lahotte.test` });
  return user;
}

/** Deuxième profil du même compte. */
function addProfile(
  user: SignedIn,
  options: { pin?: boolean; relock?: 'NEVER' | 'IDLE_15' | 'EVERY_OPEN' } = {},
): string {
  const profileId = randomUUID();
  identity.profiles.set({
    profileId,
    accountId: user.accountId,
    hasPin: options.pin ?? false,
    relock: options.relock ?? 'IDLE_15',
  });
  return profileId;
}

function ref(user: SignedIn) {
  return { id: user.sessionId, accountId: user.accountId, tokenHash: user.tokenHash };
}

/** Ré-authentification (AUTH-14) : rotation réelle, `reauth_at` éventuellement vieilli. */
async function reauthenticated(user: SignedIn, ageMs = 0): Promise<SignedIn> {
  const rotated = await app.get(SessionLifecycle).rotate(ref(user));
  const fresh = session(
    app,
    rotated.token,
    rotated.record.tokenHash,
    user.sessionId,
    user.accountId,
    rotated.record.activeProfileId,
  );
  if (ageMs > 0) {
    await identity.sessions.patchCache(fresh.tokenHash, { reauthAt: new Date(Date.now() - ageMs) });
  }
  return fresh;
}

const profileRoute = '/api/v1/_identity-test/profile';

function select(user: SignedIn, profileId: string, pin?: string) {
  return http()
    .post('/api/v1/session/profile')
    .set(user.mutation)
    .send(pin === undefined ? { profileId } : { profileId, pin });
}

describe('POST /session/profile (PRO-07, PIN-02, PIN-07)', () => {
  it('profil sans PIN : actif et déverrouillé', async () => {
    const user = await account();
    const other = addProfile(user);
    const res = await select(user, other).expect(200);
    expect(res.body).toEqual({
      activeProfileId: other,
      profileUnlocked: true,
      pinResetNoticeAt: null,
      failedPinAttempts: 0,
    });
    const me = await http().get(profileRoute).set('Cookie', user.cookie).expect(200);
    expect(me.body).toEqual({ profileId: other });
  });

  it('profil à PIN sans PIN envoyé : actif, verrouillé (423 sur une route de profil)', async () => {
    const user = await account();
    const locked = addProfile(user, { pin: true });
    const res = await select(user, locked).expect(200);
    expect(res.body).toMatchObject({ activeProfileId: locked, profileUnlocked: false });
    await http().get(profileRoute).set('Cookie', user.cookie).expect(423);
  });

  it('PIN juste : déverrouillé ; IDLE_15 ne pose pas de cookie de déverrouillage', async () => {
    const user = await account();
    const locked = addProfile(user, { pin: true });
    const res = await select(user, locked, TEST_PIN).expect(200);
    expect(res.body).toMatchObject({ activeProfileId: locked, profileUnlocked: true });
    expect(lastCookie(res, UNLOCK_COOKIE)).toBe('');
    await http().get(profileRoute).set('Cookie', user.cookie).expect(200);
  });

  it('PRO-07 : PIN faux, 422 PIN_INVALID ; le nouveau profil est actif et verrouillé, la ré-authentification effacée', async () => {
    const user = await reauthenticated(await account());
    const locked = addProfile(user, { pin: true });
    const res = await select(user, locked, '0000').expect(422);
    expect(res.body).toMatchObject({ code: 'PIN_INVALID' });
    expect(res.text).not.toContain('0000');
    const status = await http().get('/api/v1/session').set('Cookie', user.cookie).expect(200);
    expect(status.body.session).toMatchObject({ activeProfileId: locked, profileUnlocked: false });
    await http().post('/api/v1/_identity-test/reauth').set(user.mutation).expect(401);
  });

  it('SEC-03, SEC-04 : profil d’un autre compte ou inconnu : 404, rien ne change', async () => {
    const user = await account();
    const stranger = await account();
    for (const profileId of [stranger.profileId ?? '', randomUUID()]) {
      const res = await select(user, profileId).expect(404);
      expect(res.body).toMatchObject({ code: 'PROFILE_NOT_FOUND' });
    }
    await http().get(profileRoute).set('Cookie', user.cookie).expect(200);
  });

  it('validation : PIN mal formé 400, sans le renvoyer', async () => {
    const user = await account();
    const res = await select(user, user.profileId ?? '', '12a4').expect(400);
    expect(res.text).not.toContain('12a4');
  });

  it('EVERY_OPEN : cookie de déverrouillage de session (sans Max-Age), exigé ensuite', async () => {
    const user = await account();
    const locked = addProfile(user, { pin: true, relock: 'EVERY_OPEN' });
    const res = await select(user, locked, TEST_PIN).expect(200);
    const line = cookiesOf(res)
      .filter((c) => c.startsWith(`${UNLOCK_COOKIE}=`))
      .at(-1);
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/SameSite=Strict/);
    expect(line).not.toMatch(/Max-Age|Expires/);
    const nonce = lastCookie(res, UNLOCK_COOKIE);
    expect(nonce).toBeTruthy();

    // Navigateur rouvert : plus de cookie, profil verrouillé.
    await http().get(profileRoute).set('Cookie', user.cookie).expect(423);
    await http()
      .get(profileRoute)
      .set('Cookie', `${user.cookie}; ${UNLOCK_COOKIE}=${nonce ?? ''}`)
      .expect(200);
    await http()
      .get(profileRoute)
      .set('Cookie', `${user.cookie}; ${UNLOCK_COOKIE}=${'x'.repeat(43)}`)
      .expect(423);
  });
});

describe('PIN-03 : attente après 5 erreurs consécutives', () => {
  it('rafale parallèle de 5 PIN faux : 5 refus, puis 429 sans évaluer même le bon PIN ; journal et e-mail', async () => {
    const user = await account();
    const locked = addProfile(user, { pin: true });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => select(user, locked, '0000')),
    );
    expect(results.map((r) => r.status)).toEqual([422, 422, 422, 422, 422]);

    const blocked = await select(user, locked, TEST_PIN).expect(429);
    expect(blocked.body).toMatchObject({ code: 'PIN_RATE_LIMITED' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
    await http().get(profileRoute).set('Cookie', user.cookie).expect(423);

    expect(identity.securityLog.entries.filter((e) => e.event === 'pin.locked')).toHaveLength(1);
    await identity.background.flush();
    const mails = identity.mail.sent.filter((m) => m.to === `p-${user.accountId}@lahotte.test`);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.text).not.toContain('Profil de test');
  });

  it('attente écoulée : un seul essai, attente suivante de 5 minutes ; PIN juste remet à zéro', async () => {
    const user = await account();
    const locked = addProfile(user, { pin: true });
    for (let i = 0; i < 5; i += 1) await select(user, locked, '0000').expect(422);
    const stored = identity.profileRepository.profiles.get(locked);
    if (!stored) throw new Error('profil absent');
    stored.pinLockedUntil = new Date(Date.now() - 1000);

    await select(user, locked, '0000').expect(422);
    const next = await select(user, locked, TEST_PIN).expect(429);
    expect(Number(next.headers['retry-after'])).toBeGreaterThan(60);
    expect(Number(next.headers['retry-after'])).toBeLessThanOrEqual(300);

    stored.pinLockedUntil = new Date(Date.now() - 1000);
    const entered = await select(user, locked, TEST_PIN).expect(200);
    // Revue SEC-40, I3 : le titulaire voit les essais faux faits depuis sa dernière entrée.
    expect(entered.body).toMatchObject({ profileUnlocked: true, failedPinAttempts: 6 });
    expect(stored.pinFailedCount).toBe(0);
    expect(stored.pinLockedUntil).toBeNull();
    const again = await select(user, locked, TEST_PIN).expect(200);
    expect(again.body).toMatchObject({ failedPinAttempts: 0 });
  });

  it('revue SEC-40, C2-M1 : changer son PIN n’efface pas les essais faux faits entre-temps', async () => {
    const owner = await account({ pin: true });
    const target = owner.profileId ?? '';
    await select(owner, target, TEST_PIN).expect(200);
    // Un proche, depuis une autre session du compte.
    const lifecycle = app.get(SessionLifecycle);
    const issued = await lifecycle.create({
      accountId: owner.accountId,
      observedEpoch: (await lifecycle.observeEpoch(owner.accountId)) ?? -1,
      userAgent: 'ua',
    });
    const intruder = session(
      app,
      issued.token,
      issued.record.tokenHash,
      issued.record.id,
      owner.accountId,
      target,
    );
    await select(intruder, target, '0000').expect(422);
    await select(intruder, target, '1111').expect(422);

    await http()
      .put('/api/v1/profiles/me/pin')
      .set(owner.mutation)
      .send({ currentPin: TEST_PIN, newPin: OTHER_PIN })
      .expect(204);
    const entered = await select(owner, target, OTHER_PIN).expect(200);
    expect(entered.body).toMatchObject({ failedPinAttempts: 2 });
  });
});

describe('POST /session/lock (PIN-07)', () => {
  it('verrouille le profil actif, efface la ré-authentification et le cookie de déverrouillage', async () => {
    const user = await account({ pin: true });
    await select(user, user.profileId ?? '', TEST_PIN).expect(200);
    const fresh = await reauthenticated(user);
    await select(fresh, user.profileId ?? '', TEST_PIN).expect(200);
    const again = await reauthenticated(fresh);

    const res = await http().post('/api/v1/session/lock').set(again.mutation).expect(204);
    expect(lastCookie(res, UNLOCK_COOKIE)).toBe('');
    await http().get(profileRoute).set('Cookie', again.cookie).expect(423);
    await http().post('/api/v1/_identity-test/reauth').set(again.mutation).expect(401);
    const status = await http().get('/api/v1/session').set('Cookie', again.cookie).expect(200);
    expect(status.body.session).toMatchObject({ activeProfileId: user.profileId });
  });
});

describe('PRO-04 : sélection d’office', () => {
  it('compte à deux profils : aucun profil actif à la connexion', async () => {
    const user = await account();
    addProfile(user);
    const lifecycle = app.get(SessionLifecycle);
    const issued = await lifecycle.create({
      accountId: user.accountId,
      observedEpoch: (await lifecycle.observeEpoch(user.accountId)) ?? -1,
      userAgent: 'ua',
    });
    expect(issued.record.activeProfileId).toBeNull();
  });

  it('compte à un profil à PIN : actif d’office, verrouillé', async () => {
    const user = await account({ pin: true });
    const lifecycle = app.get(SessionLifecycle);
    const issued = await lifecycle.create({
      accountId: user.accountId,
      observedEpoch: (await lifecycle.observeEpoch(user.accountId)) ?? -1,
      userAgent: 'ua',
    });
    expect(issued.record.activeProfileId).toBe(user.profileId);
    const signed = session(
      app,
      issued.token,
      issued.record.tokenHash,
      issued.record.id,
      user.accountId,
      user.profileId,
    );
    await http().get(profileRoute).set('Cookie', signed.cookie).expect(423);
  });
});

describe('/profiles/me (PRO-02, PRO-03)', () => {
  it('GET : profil actif, ETag de sa version ; verrouillé : 423', async () => {
    const user = await account({ pin: true });
    await http().get('/api/v1/profiles/me').set('Cookie', user.cookie).expect(423);
    await select(user, user.profileId ?? '', TEST_PIN).expect(200);
    const res = await http().get('/api/v1/profiles/me').set('Cookie', user.cookie).expect(200);
    expect(res.headers.etag).toBe('"1"');
    expect(res.body).toEqual({
      id: user.profileId,
      displayName: 'Profil de test',
      avatar: null,
      accentColor: '#336699',
      birthday: null,
      locale: 'fr',
      currency: 'EUR',
      timezone: 'Europe/Paris',
      isChild: false,
      hasPin: true,
      pinRelock: 'IDLE_15',
      pinResetNoticeAt: null,
      childNoticeAt: null,
      email: null,
      version: 1,
    });
    expect(res.text).not.toMatch(/pinHash|fake\$/);
  });

  it('revue SEC-40, M1 : affaiblir le reverrouillage d’un profil à PIN exige le PIN courant', async () => {
    const user = await account({ pin: true, relock: 'EVERY_OPEN' });
    const selected = await select(user, user.profileId ?? '', TEST_PIN).expect(200);
    const nonce = lastCookie(selected, UNLOCK_COOKIE) ?? '';
    const headers = { ...user.mutation, Cookie: `${user.cookie}; ${UNLOCK_COOKIE}=${nonce}` };
    const patch = () => http().patch('/api/v1/profiles/me').set(headers).set('If-Match', '"1"');

    const missing = await patch().send({ pinRelock: 'NEVER' }).expect(422);
    expect(missing.body).toMatchObject({ code: 'CURRENT_PIN_REQUIRED' });
    await patch().send({ pinRelock: 'IDLE_15', currentPin: '0000' }).expect(422);
    await patch().send({ pinRelock: 'NEVER', currentPin: TEST_PIN }).expect(200);
    // Renforcer ne demande rien.
    await http()
      .patch('/api/v1/profiles/me')
      .set(headers)
      .set('If-Match', '"2"')
      .send({ pinRelock: 'IDLE_15' })
      .expect(200);
  });

  it('PATCH : If-Match exigé ; version dépassée 412 ; sinon version augmentée', async () => {
    const user = await account();
    const patch = () => http().patch('/api/v1/profiles/me').set(user.mutation);
    await patch().send({ displayName: 'Nouveau' }).expect(400);
    const ok = await patch()
      .set('If-Match', '"1"')
      .send({
        displayName: '  Nouveau nom ',
        birthday: { day: 29, month: 2, year: null },
        locale: 'en',
        currency: 'USD',
        timezone: 'America/Montreal',
        pinRelock: 'NEVER',
      })
      .expect(200);
    expect(ok.body).toMatchObject({
      displayName: 'Nouveau nom',
      birthday: { day: 29, month: 2, year: null },
      locale: 'en',
      currency: 'USD',
      timezone: 'America/Montreal',
      pinRelock: 'NEVER',
      version: 2,
    });
    expect(ok.headers.etag).toBe('"2"');
    const stale = await patch().set('If-Match', '"1"').send({ displayName: 'Autre' }).expect(412);
    expect(stale.body).toMatchObject({ code: 'VERSION_MISMATCH' });
    await patch().set('If-Match', '2').send({ birthday: null }).expect(200);
  });

  it('PRO-03 : le marqueur enfant ne se modifie pas depuis le profil', async () => {
    const user = await account();
    await http()
      .patch('/api/v1/profiles/me')
      .set(user.mutation)
      .set('If-Match', '"1"')
      .send({ isChild: true })
      .expect(400);
  });

  it('PRO-02 : date impossible ou fuseau inconnu refusés', async () => {
    const user = await account();
    const patch = () =>
      http().patch('/api/v1/profiles/me').set(user.mutation).set('If-Match', '"1"');
    const res = await patch()
      .send({ birthday: { day: 31, month: 4 } })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_PROFILE' });
    await patch()
      .send({ birthday: { day: 29, month: 2, year: 2023 } })
      .expect(422);
    await patch().send({ timezone: 'Mars/Olympus' }).expect(400);
  });
});

describe('PUT /profiles/me/pin (PIN-04)', () => {
  it('créer son PIN : la session reste déverrouillée, les autres sessions du profil sont verrouillées', async () => {
    const user = await account();
    const elsewhere = await account();
    // Seconde session du même compte, même profil actif.
    const lifecycle = app.get(SessionLifecycle);
    const issued = await lifecycle.create({
      accountId: user.accountId,
      observedEpoch: (await lifecycle.observeEpoch(user.accountId)) ?? -1,
      userAgent: 'ua',
    });
    const second = session(
      app,
      issued.token,
      issued.record.tokenHash,
      issued.record.id,
      user.accountId,
      user.profileId,
    );
    await http().get(profileRoute).set('Cookie', second.cookie).expect(200);

    await http()
      .put('/api/v1/profiles/me/pin')
      .set(user.mutation)
      .send({ newPin: TEST_PIN })
      .expect(204);
    await http().get(profileRoute).set('Cookie', user.cookie).expect(200);
    await http().get(profileRoute).set('Cookie', second.cookie).expect(423);
    await http().get(profileRoute).set('Cookie', elsewhere.cookie).expect(200);
    expect(identity.securityLog.entries.at(-1)).toMatchObject({ event: 'pin.changed' });
  });

  it('critère de 01 : changer son PIN avec l’ancien, sans ré-authentification', async () => {
    const user = await account({ pin: true });
    await select(user, user.profileId ?? '', TEST_PIN).expect(200);
    const put = () => http().put('/api/v1/profiles/me/pin').set(user.mutation);
    const missing = await put().send({ newPin: OTHER_PIN }).expect(422);
    expect(missing.body).toMatchObject({ code: 'CURRENT_PIN_REQUIRED' });
    await put().send({ currentPin: '0000', newPin: OTHER_PIN }).expect(422);
    await put().send({ currentPin: TEST_PIN, newPin: OTHER_PIN }).expect(204);

    await select(user, user.profileId ?? '', TEST_PIN).expect(422);
    await select(user, user.profileId ?? '', OTHER_PIN).expect(200);
  });

  it('critère de 01 : impossible de désactiver son PIN depuis le profil', async () => {
    const user = await account({ pin: true });
    await select(user, user.profileId ?? '', TEST_PIN).expect(200);
    await http()
      .put('/api/v1/profiles/me/pin')
      .set(user.mutation)
      .send({ currentPin: TEST_PIN })
      .expect(400);
    await http()
      .put('/api/v1/profiles/me/pin')
      .set(user.mutation)
      .send({ currentPin: TEST_PIN, newPin: null })
      .expect(400);
  });
});

describe('Espace Compte : /account/profiles (PIN-08, PRO-08)', () => {
  it('critère de 01 : forme figée, métadonnées seulement, accessible profil verrouillé', async () => {
    const user = await account({ pin: true });
    const res = await http().get('/api/v1/account/profiles').set('Cookie', user.cookie).expect(200);
    expect(Object.keys(res.body as object)).toEqual(['items']);
    for (const item of res.body.items as object[]) {
      expect(Object.keys(item).sort()).toEqual(
        ['accentColor', 'avatar', 'displayName', 'hasEmail', 'hasPin', 'id', 'isChild'].sort(),
      );
    }
    expect(res.body.items).toEqual([
      {
        id: user.profileId,
        displayName: 'Profil de test',
        avatar: null,
        accentColor: '#336699',
        hasPin: true,
        isChild: false,
        hasEmail: false,
      },
    ]);
  });

  it('création : 201, sans ré-authentification ; 10 au plus ; compte non vérifié refusé', async () => {
    const user = await account();
    const created = await http()
      .post('/api/v1/account/profiles')
      .set(user.mutation)
      .send({ displayName: ' Léa ', isChild: true })
      .expect(201);
    expect(created.body).toMatchObject({ displayName: 'Léa', isChild: true, hasPin: false });
    for (let i = 0; i < 8; i += 1) {
      await http()
        .post('/api/v1/account/profiles')
        .set(user.mutation)
        .send({ displayName: `P${i}` })
        .expect(201);
    }
    const full = await http()
      .post('/api/v1/account/profiles')
      .set(user.mutation)
      .send({ displayName: 'Onzième' })
      .expect(422);
    expect(full.body).toMatchObject({ code: 'PROFILE_LIMIT_REACHED' });

    const unverified = await account();
    identity.accounts.seed({
      id: unverified.accountId,
      email: `u-${unverified.accountId}@lahotte.test`,
      emailVerifiedAt: null,
    });
    const refused = await http()
      .post('/api/v1/account/profiles')
      .set(unverified.mutation)
      .send({ displayName: 'Autre' })
      .expect(403);
    expect(refused.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('suppression : ré-authentification exigée ; sessions du profil revenues à la sélection ; jamais le dernier', async () => {
    const user = await account();
    const second = addProfile(user);
    await http().delete(`/api/v1/account/profiles/${second}`).set(user.mutation).expect(401);

    await select(user, second).expect(200);
    const fresh = await reauthenticated(user);
    await http().delete(`/api/v1/account/profiles/${second}`).set(fresh.mutation).expect(204);
    const status = await http().get('/api/v1/session').set('Cookie', fresh.cookie).expect(200);
    expect(status.body.session).toMatchObject({ activeProfileId: null });
    expect(identity.securityLog.entries.at(-1)).toMatchObject({ event: 'profile.deleted' });
    // C'était le profil actif de l'appelant : comme tout changement de profil, sa
    // ré-authentification est effacée (AUTH-14).
    await http()
      .delete(`/api/v1/account/profiles/${user.profileId ?? ''}`)
      .set(fresh.mutation)
      .expect(401);

    const again = await reauthenticated(fresh);
    const last = await http()
      .delete(`/api/v1/account/profiles/${user.profileId ?? ''}`)
      .set(again.mutation)
      .expect(422);
    expect(last.body).toMatchObject({ code: 'LAST_PROFILE' });
  });

  it('SEC-04 : profil d’un autre compte : 404 partout', async () => {
    const user = await reauthenticated(await account());
    const stranger = await account({ pin: true });
    const id = stranger.profileId ?? '';
    await http().delete(`/api/v1/account/profiles/${id}`).set(user.mutation).expect(404);
    await http()
      .put(`/api/v1/account/profiles/${id}/pin/reset`)
      .set(user.mutation)
      .send({ newPin: OTHER_PIN })
      .expect(404);
    await http().delete(`/api/v1/account/profiles/${id}/pin`).set(user.mutation).expect(404);
    await select(stranger, id, TEST_PIN).expect(200);
  });
});

describe('PIN-05 : réinitialiser ou désactiver un PIN depuis l’espace Compte', () => {
  it('critère de 01 : ré-authentification de moins de 2 minutes exigée', async () => {
    const user = await account({ pin: true });
    const old = await reauthenticated(user, 3 * MINUTE);
    const res = await http()
      .delete(`/api/v1/account/profiles/${user.profileId ?? ''}/pin`)
      .set(old.mutation)
      .expect(401);
    expect(res.body).toMatchObject({ code: 'REAUTH_REQUIRED' });
    await http()
      .put(`/api/v1/account/profiles/${user.profileId ?? ''}/pin/reset`)
      .set(old.mutation)
      .send({ newPin: OTHER_PIN })
      .expect(401);
  });

  it('critère de 01 : la ré-authentification est perdue au changement de profil et au verrouillage', async () => {
    const user = await account({ pin: true });
    const second = addProfile(user);
    const fresh = await reauthenticated(user);
    await select(fresh, second).expect(200);
    await http()
      .delete(`/api/v1/account/profiles/${user.profileId ?? ''}/pin`)
      .set(fresh.mutation)
      .expect(401);

    const again = await reauthenticated(fresh);
    await http().post('/api/v1/session/lock').set(again.mutation).expect(204);
    await http()
      .delete(`/api/v1/account/profiles/${user.profileId ?? ''}/pin`)
      .set(again.mutation)
      .expect(401);
  });

  it('réinitialisation : nouveau PIN, profil verrouillé partout, notice à chaque entrée jusqu’au PIN redonné par le profil', async () => {
    const user = await account({ pin: true });
    await select(user, user.profileId ?? '', TEST_PIN).expect(200);
    const fresh = await reauthenticated(user);
    await select(fresh, user.profileId ?? '', TEST_PIN).expect(200);
    const final = await reauthenticated(fresh);

    await http()
      .put(`/api/v1/account/profiles/${user.profileId ?? ''}/pin/reset`)
      .set(final.mutation)
      .send({ newPin: OTHER_PIN })
      .expect(204);
    await http().get(profileRoute).set('Cookie', final.cookie).expect(423);
    expect(identity.securityLog.entries.at(-1)).toMatchObject({ event: 'pin.reset' });

    await select(final, user.profileId ?? '', TEST_PIN).expect(422);
    const entered = await select(final, user.profileId ?? '', OTHER_PIN).expect(200);
    expect(entered.body.pinResetNoticeAt).toEqual(expect.any(String));
    // Revue SEC-40, B1 : une entrée ne l'efface pas ; seul le profil, en se redonnant un PIN.
    const again = await select(final, user.profileId ?? '', OTHER_PIN).expect(200);
    expect(again.body.pinResetNoticeAt).toEqual(entered.body.pinResetNoticeAt);
    const me = await http().get('/api/v1/profiles/me').set('Cookie', final.cookie).expect(200);
    expect(me.body.pinResetNoticeAt).toEqual(entered.body.pinResetNoticeAt);
    await http()
      .put('/api/v1/profiles/me/pin')
      .set(final.mutation)
      .send({ currentPin: OTHER_PIN, newPin: TEST_PIN })
      .expect(204);
    const after = await select(final, user.profileId ?? '', TEST_PIN).expect(200);
    expect(after.body.pinResetNoticeAt).toBeNull();
  });

  it('revue SEC-40, B1 : désactivation puis entrée d’un tiers : la notice est encore rendue à l’entrée suivante', async () => {
    const owner = await account({ pin: true });
    const target = owner.profileId ?? '';
    const intruder = await reauthenticated(owner);
    await http()
      .delete(`/api/v1/account/profiles/${target}/pin`)
      .set(intruder.mutation)
      .expect(204);
    const first = await select(intruder, target).expect(200);
    expect(first.body.pinResetNoticeAt).toEqual(expect.any(String));
    // Le titulaire revient : la notice est toujours là.
    const back = await select(intruder, target).expect(200);
    expect(back.body.pinResetNoticeAt).toEqual(first.body.pinResetNoticeAt);
  });

  it('revue SEC-40, I2 : une réinitialisation rend sans effet le déverrouillage d’avant, même réécrit après', async () => {
    const user = await account({ pin: true });
    await select(user, user.profileId ?? '', TEST_PIN).expect(200);
    const stale = identity.sessions.cache.get(user.tokenHash)?.unlock ?? null;
    expect(stale?.pinStamp).toEqual(expect.any(String));
    const fresh = await reauthenticated(user);
    await http()
      .put(`/api/v1/account/profiles/${user.profileId ?? ''}/pin/reset`)
      .set(fresh.mutation)
      .send({ newPin: OTHER_PIN })
      .expect(204);
    // Course : le déverrouillage donné par l'ancien PIN arrive après la réinitialisation.
    await identity.sessions.patchCache(fresh.tokenHash, { unlock: stale });
    await http().get(profileRoute).set('Cookie', fresh.cookie).expect(423);
  });

  it('désactivation : le profil n’a plus de PIN, la notice s’affiche à l’entrée ; sans PIN : 422', async () => {
    const user = await account({ pin: true });
    const fresh = await reauthenticated(user);
    await http()
      .delete(`/api/v1/account/profiles/${user.profileId ?? ''}/pin`)
      .set(fresh.mutation)
      .expect(204);
    expect(identity.securityLog.entries.at(-1)).toMatchObject({ event: 'pin.disabled' });
    const entered = await select(fresh, user.profileId ?? '').expect(200);
    expect(entered.body).toMatchObject({
      profileUnlocked: true,
      pinResetNoticeAt: expect.any(String),
    });

    const final = await reauthenticated(fresh);
    const res = await http()
      .delete(`/api/v1/account/profiles/${user.profileId ?? ''}/pin`)
      .set(final.mutation)
      .expect(422);
    expect(res.body).toMatchObject({ code: 'PIN_NOT_SET' });
  });

  it('réinitialisation : remet le compteur PIN-03 à zéro', async () => {
    const user = await account({ pin: true });
    for (let i = 0; i < 5; i += 1) await select(user, user.profileId ?? '', '0000').expect(422);
    await select(user, user.profileId ?? '', TEST_PIN).expect(429);
    const fresh = await reauthenticated(user);
    await http()
      .put(`/api/v1/account/profiles/${user.profileId ?? ''}/pin/reset`)
      .set(fresh.mutation)
      .send({ newPin: OTHER_PIN })
      .expect(204);
    await select(fresh, user.profileId ?? '', OTHER_PIN).expect(200);
  });
});

describe('API-21 : mutations de profil protégées contre le CSRF', () => {
  it('sans jeton : 403', async () => {
    const user = await account();
    await http()
      .post('/api/v1/session/profile')
      .set({ Cookie: user.cookie, Origin: WEB_ORIGIN })
      .send({ profileId: user.profileId })
      .expect(403);
  });
});
