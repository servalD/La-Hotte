import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { generate } from 'otplib';
import request from 'supertest';
import {
  DEVICE_COOKIE,
  PENDING_COOKIE,
  PRESESSION_COOKIE,
  SESSION_COOKIE,
} from '../../src/modules/identity/presentation/cookies';
import { session as sessionHeaders, type SignedIn, WEB_ORIGIN } from '../support/sign-in';
import { createTestApp, type TestIdentity } from './create-test-app';

// Second facteur (AUTH-05, AUTH-07, AUTH-10 à AUTH-14 ; SEC-22 ; ADR 0013 « Pré-authentification »).

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
const PASSWORD = 'une phrase de passe assez longue';
const RECOVERY_CODE = /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/;

function cookiesOf(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function setCookie(res: request.Response, name: string): string | undefined {
  return cookiesOf(res).find((c) => c.startsWith(`${name}=`));
}

function cookieValue(res: request.Response, name: string): string | null {
  const found = setCookie(res, name);
  return found ? decodeURIComponent(found.split(';')[0]?.slice(name.length + 1) ?? '') : null;
}

/** Code TOTP du pas courant, décalé de `steps` pas (± 1 accepté). */
async function totp(secret: string, steps = 0): Promise<string> {
  return generate({ secret, epoch: Math.floor(Date.now() / 1000) + steps * 30 });
}

/**
 * Oublie le dernier pas accepté (AUTH-11) : seulement dans les tests qui enchaînent plusieurs
 * codes dans la même fenêtre et dont le sujet n'est pas l'anti-rejeu.
 */
function forgetLastStep(accountId: string): void {
  identity.secondFactors.lastSteps.delete(accountId);
}

interface Presession {
  readonly id: string;
  readonly headers: Record<string, string>;
}

async function presession(): Promise<Presession> {
  const res = await http().get('/api/v1/session').expect(200);
  const id = cookieValue(res, PRESESSION_COOKIE) ?? '';
  return {
    id,
    headers: {
      Cookie: `${PRESESSION_COOKIE}=${id}`,
      'X-CSRF-Token': res.body.csrfToken as string,
      Origin: WEB_ORIGIN,
    },
  };
}

/** Compte vérifié, avec mot de passe. */
async function account(): Promise<{ email: string; accountId: string }> {
  const email = `t-${randomUUID()}@lahotte.test`;
  const accountId = randomUUID();
  identity.accounts.seed({
    id: accountId,
    email,
    passwordHash: await identity.hasher.hash(PASSWORD),
  });
  return { email, accountId };
}

function signedFrom(res: request.Response, accountId: string): SignedIn {
  const token = cookieValue(res, SESSION_COOKIE) ?? '';
  const sessionId = res.body.session.id as string;
  const row = identity.sessions.rows.get(sessionId);
  if (!row) throw new Error('Session absente');
  return sessionHeaders(app, token, row.tokenHash, sessionId, accountId, null);
}

function postLogin(email: string, pre: Presession, extraCookie = ''): request.Test {
  return http()
    .post('/api/v1/auth/login')
    .set({ ...pre.headers, Cookie: `${pre.headers.Cookie ?? ''}${extraCookie}` })
    .send({ email, password: PASSWORD });
}

/** Connexion sans TOTP : session ouverte. */
async function login(email: string, accountId: string): Promise<SignedIn> {
  const res = await postLogin(email, await presession()).expect(200);
  expect(res.body.authenticated).toBe(true);
  return signedFrom(res, accountId);
}

/** Connexion avec TOTP : en-têtes de la pré-authentification (pré-session et `__Host-lh_pending`). */
async function loginPending(email: string, extraCookie = ''): Promise<Record<string, string>> {
  const pre = await presession();
  const res = await postLogin(email, pre, extraCookie).expect(200);
  expect(res.body).toMatchObject({
    authenticated: false,
    session: null,
    secondFactorPending: true,
  });
  const pending = cookieValue(res, PENDING_COOKIE) ?? '';
  return {
    ...pre.headers,
    Cookie: `${PRESESSION_COOKIE}=${pre.id}; ${PENDING_COOKIE}=${pending}${extraCookie}`,
  };
}

function verify(
  headers: Record<string, string>,
  code: string,
  trustDevice?: boolean,
): request.Test {
  return http()
    .post('/api/v1/auth/totp/verify')
    .set(headers)
    .send(trustDevice === undefined ? { code } : { code, trustDevice });
}

async function reauth(user: SignedIn, code?: string): Promise<SignedIn> {
  const res = await http()
    .post('/api/v1/auth/reauth')
    .set(user.mutation)
    .send(code ? { password: PASSWORD, code } : { password: PASSWORD })
    .expect(200);
  return signedFrom(res, user.accountId);
}

/**
 * TOTP activé par les routes réelles : secret, codes de secours, et la session neuve rendue par
 * l'activation (AUTH-05 : les autres sont tombées), **sans** ré-authentification récente.
 */
async function enableTotp(
  email: string,
  accountId: string,
): Promise<{ secret: string; recoveryCodes: string[]; user: SignedIn }> {
  const user = await reauth(await login(email, accountId));
  const enrolled = await http().post('/api/v1/auth/totp/enroll').set(user.mutation).expect(200);
  const secret = enrolled.body.secret as string;
  const activated = await http()
    .post('/api/v1/auth/totp/activate')
    .set(user.mutation)
    .send({ code: await totp(secret) })
    .expect(200);
  return {
    secret,
    recoveryCodes: activated.body.recoveryCodes as string[],
    user: signedFrom(activated, accountId),
  };
}

/** Ré-authentification par un code de secours (le dernier), qui ne touche pas aux pas TOTP. */
async function reauthWithRecovery(user: SignedIn, recoveryCodes: string[]): Promise<SignedIn> {
  return reauth(user, recoveryCodes[9]);
}

describe('Activation du TOTP (AUTH-10, AUTH-11, AUTH-14, SEC-22)', () => {
  it('exige une ré-authentification récente', async () => {
    const { email, accountId } = await account();
    const user = await login(email, accountId);
    const res = await http().post('/api/v1/auth/totp/enroll').set(user.mutation).expect(401);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
  });

  it('QR code, confirmation par un code, 10 codes de secours affichés une fois ; secret chiffré', async () => {
    const { email, accountId } = await account();
    const user = await reauth(await login(email, accountId));

    const enrolled = await http().post('/api/v1/auth/totp/enroll').set(user.mutation).expect(200);
    expect(enrolled.headers['cache-control']).toBe('no-store');
    const secret = enrolled.body.secret as string;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrolled.body.otpauthUri).toContain(`secret=${secret}`);
    // SEC-22 : au repos, seulement le chiffré.
    const stored = identity.secondFactors.secrets.get(accountId);
    expect(Buffer.from(stored ?? []).toString('latin1')).not.toContain(secret);

    // Pas encore actif : la connexion n'attend pas de code.
    await login(email, accountId);

    const wrong = await http()
      .post('/api/v1/auth/totp/activate')
      .set(user.mutation)
      .send({ code: (Number(await totp(secret)) ^ 1).toString().padStart(6, '0') })
      .expect(401);
    expect(wrong.body.code).toBe('INVALID_SECOND_FACTOR');

    const activated = await http()
      .post('/api/v1/auth/totp/activate')
      .set(user.mutation)
      .send({ code: await totp(secret) })
      .expect(200);
    const codes = activated.body.recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(RECOVERY_CODE);
    // Stockés hachés seulement.
    const hashes = [...(identity.secondFactors.recoveryCodes.get(accountId)?.keys() ?? [])];
    expect(hashes).toHaveLength(10);
    for (const code of codes) expect(hashes.join()).not.toContain(code.replace(/-/g, ''));

    // AUTH-05 : toutes les sessions sont tombées, celle de l'appelant comprise ; une neuve la
    // remplace, sans ré-authentification récente.
    expect(activated.body).toMatchObject({ authenticated: true, secondFactorPending: false });
    await http().get('/api/v1/account').set('Cookie', user.cookie).expect(401);
    const renewed = signedFrom(activated, accountId);
    const summary = await http().get('/api/v1/account').set('Cookie', renewed.cookie).expect(200);
    expect(summary.body).toEqual({
      email,
      emailVerified: true,
      hasPassword: true,
      googleLinked: false,
      totpEnabled: true,
      recoveryCodesRemaining: 10,
    });
    await identity.background.flush();
    expect(identity.mail.sent.at(-1)).toMatchObject({
      to: email,
      subject: 'Double authentification activée',
    });
    expect(identity.securityLog.entries.map((e) => e.event)).toEqual(
      expect.arrayContaining(['totp.enrollment_started', 'totp.enabled']),
    );

    // Déjà actif : pas de nouvelle inscription.
    const ready = await reauthWithRecovery(renewed, codes);
    await http().post('/api/v1/auth/totp/enroll').set(ready.mutation).expect(409);
  });

  it('AUTH-05 : activer le TOTP déconnecte les autres sessions', async () => {
    const { email, accountId } = await account();
    const other = await login(email, accountId);
    await enableTotp(email, accountId);
    await http().get('/api/v1/account').set('Cookie', other.cookie).expect(401);
  });

  it('activation sans inscription en cours : 409', async () => {
    const { email, accountId } = await account();
    const user = await reauth(await login(email, accountId));
    const res = await http()
      .post('/api/v1/auth/totp/activate')
      .set(user.mutation)
      .send({ code: '123456' })
      .expect(409);
    expect(res.body.code).toBe('TOTP_ENROLLMENT_MISSING');
  });
});

describe('Connexion avec TOTP (AUTH-07, AUTH-11, AUTH-12, ADR 0013)', () => {
  it('pré-authentification sans session, puis session au code juste', async () => {
    const { email, accountId } = await account();
    const { secret } = await enableTotp(email, accountId);

    const pre = await presession();
    const res = await postLogin(email, pre).expect(200);
    expect(setCookie(res, SESSION_COOKIE)).toBeUndefined();
    const pendingCookie = setCookie(res, PENDING_COOKIE) ?? '';
    expect(pendingCookie).toMatch(/HttpOnly/);
    expect(pendingCookie).toMatch(/Secure/);
    expect(pendingCookie).toMatch(/SameSite=Strict/);
    expect(pendingCookie).toMatch(/Max-Age=300/);
    expect(res.body.csrfToken).toBe(pre.headers['X-CSRF-Token']);
    const pending = cookieValue(res, PENDING_COOKIE) ?? '';
    // Le jeton n'est stocké que haché.
    expect([...identity.pendingSecondFactors.entries.keys()].join()).not.toContain(pending);
    expect(identity.securityLog.entries.at(-1)?.event).toBe('login.second_factor_required');

    const headers = {
      ...pre.headers,
      Cookie: `${PRESESSION_COOKIE}=${pre.id}; ${PENDING_COOKIE}=${pending}`,
    };
    const status = await http().get('/api/v1/session').set('Cookie', headers.Cookie).expect(200);
    expect(status.body).toMatchObject({ authenticated: false, secondFactorPending: true });

    // Le pas d'activation est consommé : code du pas suivant (toléré).
    const verified = await verify(headers, await totp(secret, 1)).expect(200);
    expect(verified.body).toMatchObject({ authenticated: true, secondFactorPending: false });
    expect(setCookie(verified, SESSION_COOKIE)).toMatch(/HttpOnly/);
    expect(setCookie(verified, PENDING_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(setCookie(verified, DEVICE_COOKIE)).toBeUndefined();
    expect(identity.securityLog.entries.at(-1)?.event).toBe('login.succeeded');

    // Pré-authentification consommée : une seconde vérification ne crée rien.
    const again = await verify(headers, await totp(secret, 1)).expect(401);
    expect(again.body.code).toBe('SECOND_FACTOR_EXPIRED');
  });

  it('critère de 01 : un code TOTP ne peut pas être utilisé deux fois (AUTH-11)', async () => {
    const { email, accountId } = await account();
    const { secret } = await enableTotp(email, accountId);
    const code = await totp(secret, 1);
    await verify(await loginPending(email), code).expect(200);
    const replay = await verify(await loginPending(email), code).expect(401);
    expect(replay.body.code).toBe('INVALID_SECOND_FACTOR');
    // Le code du pas d'activation, antérieur, est refusé aussi.
    await verify(await loginPending(email), await totp(secret)).expect(401);
  });

  it('critère de 01 : après 5 échecs, recommencer le mot de passe ne donne aucun essai de plus', async () => {
    const { email, accountId } = await account();
    const { secret } = await enableTotp(email, accountId);
    const pending = await loginPending(email);
    const alerts = (): number =>
      identity.mail.sent.filter(
        (m) => m.to === email && m.subject === 'Codes de double authentification erronés',
      ).length;
    for (let i = 0; i < 5; i += 1) {
      // La pré-authentification survit à un code faux.
      const res = await verify(pending, '000000').expect(401);
      expect(res.body.code).toBe('INVALID_SECOND_FACTOR');
      await identity.background.flush();
      // AUTH-07 : le titulaire est averti au franchissement du seuil, pas avant.
      expect(alerts()).toBe(i < 4 ? 0 : 1);
    }
    expect(identity.mail.sent.at(-1)?.text).toContain('/auth/reset-password');
    // Nouveau mot de passe juste (seul le compteur du couple est remis à zéro) : le compteur du
    // second facteur, par compte, tient toujours. Le code juste n'est même pas évalué.
    const fresh = await loginPending(email);
    const limited = await verify(fresh, await totp(secret, 1)).expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(identity.secondFactors.lastSteps.get(accountId)).toBeDefined();
    expect(identity.securityLog.entries.filter((e) => e.event === 'totp.failed')).not.toHaveLength(
      0,
    );
  });

  it('code de secours : une fois seulement, avis par e-mail', async () => {
    const { email, accountId } = await account();
    const { recoveryCodes } = await enableTotp(email, accountId);
    const code = recoveryCodes[0] ?? '';
    // Saisie tolérante : minuscules, sans tirets.
    await verify(await loginPending(email), code.replace(/-/g, '').toLowerCase()).expect(200);
    await identity.background.flush();
    expect(identity.mail.sent.at(-1)).toMatchObject({
      to: email,
      subject: 'Code de secours utilisé',
    });
    expect(identity.securityLog.entries.map((e) => e.event)).toContain('recovery.code_used');

    const reused = await verify(await loginPending(email), code).expect(401);
    expect(reused.body.code).toBe('INVALID_SECOND_FACTOR');
    expect(await identity.secondFactors.countUnusedRecoveryCodes(accountId)).toBe(9);
  });

  it('ADR 0013 : une réinitialisation du mot de passe invalide la pré-authentification', async () => {
    const { email, accountId } = await account();
    const { secret } = await enableTotp(email, accountId);
    const pending = await loginPending(email);

    const pre = await presession();
    await http().post('/api/v1/auth/password/reset').set(pre.headers).send({ email }).expect(202);
    await identity.background.flush();
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set(pre.headers)
      .send({ token: identity.mail.lastToken(email), newPassword: 'une toute nouvelle phrase' })
      .expect(204);

    const res = await verify(pending, await totp(secret, 1)).expect(401);
    expect(res.body.code).toBe('SECOND_FACTOR_EXPIRED');
  });

  it('pré-authentification expirée (5 minutes) : refus, cookie retiré par GET /session', async () => {
    const { email, accountId } = await account();
    const { secret } = await enableTotp(email, accountId);
    const pending = await loginPending(email);
    identity.pendingSecondFactors.expireAll();
    const res = await verify(pending, await totp(secret, 1)).expect(401);
    expect(res.body.code).toBe('SECOND_FACTOR_EXPIRED');
    const status = await http()
      .get('/api/v1/session')
      .set('Cookie', pending.Cookie ?? '')
      .expect(200);
    expect(status.body.secondFactorPending).toBe(false);
    expect(setCookie(status, PENDING_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('sans pré-authentification, ou sans jeton CSRF : refus', async () => {
    const pre = await presession();
    const missing = await verify(pre.headers, '123456').expect(401);
    expect(missing.body.code).toBe('SECOND_FACTOR_EXPIRED');
    await http()
      .post('/api/v1/auth/totp/verify')
      .set({ Cookie: pre.headers.Cookie ?? '', Origin: WEB_ORIGIN })
      .send({ code: '123456' })
      .expect(403);
    await verify(pre.headers, 'pas un code !').expect(400);
  });
});

describe('Appareils de confiance (AUTH-12)', () => {
  it('30 jours sans TOTP sur cet appareil ; listé et révocable avec ses sessions', async () => {
    const { email, accountId } = await account();
    const { secret } = await enableTotp(email, accountId);

    const trusted = await verify(await loginPending(email), await totp(secret, 1), true).expect(
      200,
    );
    const deviceSetCookie = setCookie(trusted, DEVICE_COOKIE) ?? '';
    expect(deviceSetCookie).toMatch(/HttpOnly/);
    expect(deviceSetCookie).toMatch(/Secure/);
    expect(deviceSetCookie).toMatch(/Max-Age=2592000/);
    const device = `; ${DEVICE_COOKIE}=${cookieValue(trusted, DEVICE_COOKIE) ?? ''}`;
    expect(identity.securityLog.entries.map((e) => e.event)).toContain('device.trusted');

    // Connexion suivante depuis cet appareil : session directe, liée à l'appareil.
    const direct = await postLogin(email, await presession(), device).expect(200);
    expect(direct.body.authenticated).toBe(true);
    const user = signedFrom(direct, accountId);
    const deviceId = identity.sessions.rows.get(user.sessionId)?.trustedDeviceId;
    expect(deviceId).toEqual(expect.any(String));

    const list = await http()
      .get('/api/v1/trusted-devices')
      .set('Cookie', `${user.cookie}${device}`)
      .expect(200);
    expect(list.body.items).toEqual([
      {
        id: deviceId,
        userAgent: expect.any(String),
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
        current: true,
      },
    ]);
    expect(JSON.stringify(list.body)).not.toContain(device.split('=')[1]);

    // Révocation : l'appareil et les sessions ouvertes grâce à lui, celle-ci comprise.
    const revoked = await http()
      .delete(`/api/v1/trusted-devices/${deviceId ?? ''}`)
      .set({ ...user.mutation, Cookie: `${user.mutation.Cookie ?? ''}${device}` })
      .expect(204);
    expect(setCookie(revoked, SESSION_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(setCookie(revoked, DEVICE_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);
    await http().get('/api/v1/account').set('Cookie', user.cookie).expect(401);
    expect(identity.securityLog.entries.map((e) => e.event)).toContain('device.revoked');

    // Le cookie ne dispense plus du TOTP.
    await loginPending(email, device);
  });

  it('un appareil de confiance d’un autre compte ne dispense de rien ; 404 pour le révoquer', async () => {
    const a = await account();
    const totpA = await enableTotp(a.email, a.accountId);
    const trusted = await verify(
      await loginPending(a.email),
      await totp(totpA.secret, 1),
      true,
    ).expect(200);
    const device = `; ${DEVICE_COOKIE}=${cookieValue(trusted, DEVICE_COOKIE) ?? ''}`;
    const deviceId = [...identity.trustedDevices.devices.values()].find(
      (d) => d.accountId === a.accountId,
    )?.id;

    const b = await account();
    const totpB = await enableTotp(b.email, b.accountId);
    await loginPending(b.email, device);

    const res = await http()
      .delete(`/api/v1/trusted-devices/${deviceId ?? ''}`)
      .set(totpB.user.mutation)
      .expect(404);
    expect(res.body.code).toBe('TRUSTED_DEVICE_NOT_FOUND');
  });
});

describe('Ré-authentification avec TOTP (AUTH-14)', () => {
  it('mot de passe seul refusé ; code faux refusé ; code juste ou code de secours acceptés', async () => {
    const { email, accountId } = await account();
    const { secret, recoveryCodes, user } = await enableTotp(email, accountId);

    const missing = await http()
      .post('/api/v1/auth/reauth')
      .set(user.mutation)
      .send({ password: PASSWORD })
      .expect(422);
    expect(missing.body.code).toBe('SECOND_FACTOR_REQUIRED');

    const wrong = await http()
      .post('/api/v1/auth/reauth')
      .set(user.mutation)
      .send({ password: PASSWORD, code: '000000' })
      .expect(401);
    expect(wrong.body.code).toBe('INVALID_SECOND_FACTOR');

    const again = await reauth(user, await totp(secret, 1));
    await reauth(again, recoveryCodes[1]);
  });

  it('les codes faux de la ré-authentification comptent sur le second facteur', async () => {
    const { email, accountId } = await account();
    const { secret, user } = await enableTotp(email, accountId);
    for (let i = 0; i < 5; i += 1) {
      await http()
        .post('/api/v1/auth/reauth')
        .set(user.mutation)
        .send({ password: PASSWORD, code: '000000' })
        .expect(401);
    }
    await verify(await loginPending(email), await totp(secret, 1)).expect(429);
    // AUTH-07 : l'avertissement part aussi depuis la ré-authentification.
    await identity.background.flush();
    expect(
      identity.mail.sent.filter(
        (m) => m.to === email && m.subject === 'Codes de double authentification erronés',
      ),
    ).toHaveLength(1);
  });

  it('N3 : la réinitialisation vide le compteur du second facteur', async () => {
    const { email, accountId } = await account();
    const { secret } = await enableTotp(email, accountId);
    const pending = await loginPending(email);
    for (let i = 0; i < 5; i += 1) await verify(pending, '000000').expect(401);

    const pre = await presession();
    await http().post('/api/v1/auth/password/reset').set(pre.headers).send({ email }).expect(202);
    await identity.background.flush();
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set(pre.headers)
      .send({ token: identity.mail.lastToken(email), newPassword: PASSWORD })
      .expect(204);
    await verify(await loginPending(email), await totp(secret, 1)).expect(200);
  });
});

describe('Double envoi de l’activation (revue du cycle 2, N1)', () => {
  it('le second envoi reçoit 409 et ne déconnecte pas la session rendue par le premier', async () => {
    const { email, accountId } = await account();
    const user = await reauth(await login(email, accountId));
    const enrolled = await http().post('/api/v1/auth/totp/enroll').set(user.mutation).expect(200);
    const code = await totp(enrolled.body.secret as string);
    const first = await http()
      .post('/api/v1/auth/totp/activate')
      .set(user.mutation)
      .send({ code })
      .expect(200);
    const renewed = signedFrom(first, accountId);
    // Le second envoi porte l'ancienne session, révoquée par le premier : refusé sans effet. La
    // course réelle (deux envois simultanés) est fermée par la revérification de `ActivateTotp`.
    await http().post('/api/v1/auth/totp/activate').set(user.mutation).send({ code }).expect(401);
    await http().get('/api/v1/account').set('Cookie', renewed.cookie).expect(200);
  });
});

describe('Révocations croisées (AUTH-06, AUTH-12, AUTH-14)', () => {
  it('un mot de passe faux à la ré-authentification ne compte pas sur le second facteur', async () => {
    const { email, accountId } = await account();
    const { secret, user } = await enableTotp(email, accountId);
    for (let i = 0; i < 5; i += 1) {
      await http()
        .post('/api/v1/auth/reauth')
        .set(user.mutation)
        .send({ password: 'pas le bon mot de passe', code: '000000' })
        .expect(401);
    }
    // Le titulaire se connecte sans délai.
    await verify(await loginPending(email), await totp(secret, 1)).expect(200);
  });

  it('après une réinitialisation, le cookie d’appareil ne dispense plus du code', async () => {
    const { email, accountId } = await account();
    const { secret } = await enableTotp(email, accountId);
    const trusted = await verify(await loginPending(email), await totp(secret, 1), true).expect(
      200,
    );
    const device = `; ${DEVICE_COOKIE}=${cookieValue(trusted, DEVICE_COOKIE) ?? ''}`;

    const pre = await presession();
    await http().post('/api/v1/auth/password/reset').set(pre.headers).send({ email }).expect(202);
    await identity.background.flush();
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set(pre.headers)
      .send({ token: identity.mail.lastToken(email), newPassword: PASSWORD })
      .expect(204);

    await loginPending(email, device);
  });

  it('désactiver le TOTP invalide une pré-authentification en cours', async () => {
    const { email, accountId } = await account();
    const { secret, recoveryCodes, user } = await enableTotp(email, accountId);
    const pending = await loginPending(email);
    await http()
      .post('/api/v1/auth/totp/disable')
      .set((await reauthWithRecovery(user, recoveryCodes)).mutation)
      .expect(200);
    const res = await verify(pending, await totp(secret, 1)).expect(401);
    expect(res.body.code).toBe('SECOND_FACTOR_EXPIRED');
  });
});

describe('Codes de secours (AUTH-10)', () => {
  it('régénération : les anciens ne valent plus, les nouveaux oui', async () => {
    const { email, accountId } = await account();
    const { recoveryCodes, user } = await enableTotp(email, accountId);
    const res = await http()
      .post('/api/v1/auth/recovery-codes')
      .set((await reauthWithRecovery(user, recoveryCodes)).mutation)
      .expect(200);
    const fresh = res.body.recoveryCodes as string[];
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(recoveryCodes[0]);
    await verify(await loginPending(email), recoveryCodes[0] ?? '').expect(401);
    await verify(await loginPending(email), fresh[0] ?? '').expect(200);
  });

  it('sans TOTP actif : 409', async () => {
    const { email, accountId } = await account();
    const user = await reauth(await login(email, accountId));
    const res = await http().post('/api/v1/auth/recovery-codes').set(user.mutation).expect(409);
    expect(res.body.code).toBe('TOTP_NOT_ENABLED');
  });
});

describe('Désactivation du TOTP (AUTH-05, AUTH-14)', () => {
  it('toutes les autres sessions tombent, appareils et codes révoqués ; la connexion n’attend plus de code', async () => {
    const { email, accountId } = await account();
    const { secret, recoveryCodes, user } = await enableTotp(email, accountId);
    forgetLastStep(accountId);
    const trusted = await verify(await loginPending(email), await totp(secret), true).expect(200);
    const other = signedFrom(trusted, accountId);
    const device = `; ${DEVICE_COOKIE}=${cookieValue(trusted, DEVICE_COOKIE) ?? ''}`;

    const ready = await reauthWithRecovery(user, recoveryCodes);
    const res = await http().post('/api/v1/auth/totp/disable').set(ready.mutation).expect(200);
    expect(res.body.authenticated).toBe(true);
    expect(setCookie(res, DEVICE_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);
    const renewed = signedFrom(res, accountId);

    await http().get('/api/v1/account').set('Cookie', other.cookie).expect(401);
    await http().get('/api/v1/account').set('Cookie', ready.cookie).expect(401);
    const summary = await http().get('/api/v1/account').set('Cookie', renewed.cookie).expect(200);
    expect(summary.body).toMatchObject({ totpEnabled: false, recoveryCodesRemaining: 0 });
    expect(await identity.trustedDevices.listActive(accountId, new Date())).toEqual([]);
    await identity.background.flush();
    expect(identity.mail.sent.at(-1)).toMatchObject({
      to: email,
      subject: 'Double authentification désactivée',
    });

    // Connexion directe, même sans l'appareil.
    const direct = await postLogin(email, await presession(), device).expect(200);
    expect(direct.body.authenticated).toBe(true);
  });

  it('exige une ré-authentification récente ; 409 sans TOTP', async () => {
    const { email, accountId } = await account();
    const plain = await login(email, accountId);
    await http().post('/api/v1/auth/totp/disable').set(plain.mutation).expect(401);
    const reauthed = await reauth(plain);
    const res = await http().post('/api/v1/auth/totp/disable').set(reauthed.mutation).expect(409);
    expect(res.body.code).toBe('TOTP_NOT_ENABLED');
  });
});

describe('TOTP obligatoire pour ADMIN et MODERATOR (AUTH-13)', () => {
  function promote(accountId: string): void {
    const state = identity.sessions.accounts.get(accountId);
    if (!state) throw new Error('Compte absent');
    state.role = 'MODERATOR';
  }

  it('sans TOTP : connexion refusée en échec fermé', async () => {
    const { email, accountId } = await account();
    promote(accountId);
    const res = await postLogin(email, await presession()).expect(403);
    expect(res.body.code).toBe('TOTP_ENROLLMENT_REQUIRED');
    expect(setCookie(res, SESSION_COOKIE)).toBeUndefined();
  });

  it('avec TOTP : ni appareil de confiance, ni désactivation', async () => {
    const { email, accountId } = await account();
    const { secret, recoveryCodes, user } = await enableTotp(email, accountId);
    promote(accountId);

    const res = await verify(await loginPending(email), await totp(secret, 1), true).expect(200);
    expect(setCookie(res, DEVICE_COOKIE)).toBeUndefined();
    expect(await identity.trustedDevices.listActive(accountId, new Date())).toEqual([]);

    const refused = await http()
      .post('/api/v1/auth/totp/disable')
      .set((await reauthWithRecovery(user, recoveryCodes)).mutation)
      .expect(422);
    expect(refused.body.code).toBe('TOTP_MANDATORY');
  });
});

describe('GET /account (PIN-08)', () => {
  it('métadonnées du compte seulement : forme figée', async () => {
    const { email, accountId } = await account();
    const user = await login(email, accountId);
    const res = await http().get('/api/v1/account').set('Cookie', user.cookie).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body as object).sort()).toEqual([
      'email',
      'emailVerified',
      'googleLinked',
      'hasPassword',
      'recoveryCodesRemaining',
      'totpEnabled',
    ]);
  });
});
