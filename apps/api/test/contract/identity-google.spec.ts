import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { generate } from 'otplib';
import request from 'supertest';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { SecretTokens } from '../../src/modules/identity/domain/ports';
import {
  DEVICE_COOKIE,
  PENDING_COOKIE,
  PRESESSION_COOKIE,
  SESSION_COOKIE,
} from '../../src/modules/identity/presentation/cookies';
import { session as sessionHeaders, signIn, type SignedIn, WEB_ORIGIN } from '../support/sign-in';
import { createTestApp, type TestIdentity } from './create-test-app';

// Connexion avec Google (AUTH-01, AUTH-03, AUTH-05, AUTH-09, AUTH-12 à AUTH-15 ;
// ADR 0013 « Retour OIDC »).

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
  identity.google.enabled = true;
  identity.google.unreachable = false;
  identity.settings.registrationMode = 'OPEN';
});

const http = () => request(app.getHttpServer());
const PASSWORD = 'une phrase de passe assez longue';
const CALLBACK = '/api/v1/auth/google/callback';
const RETURN = `${WEB_ORIGIN}/auth/google/return`;
const REGISTRATION = { displayName: 'Camille', ageAttested: true };

function cookiesOf(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function cookieValue(res: request.Response, name: string): string | null {
  const found = cookiesOf(res).find((c) => c.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.split(';')[0]?.slice(name.length + 1) ?? '') : null;
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

async function startLogin(
  pre: Presession,
  registration?: Record<string, unknown>,
): Promise<string> {
  const res = await http()
    .post('/api/v1/auth/google/start')
    .set(pre.headers)
    .send(registration ? { registration } : {})
    .expect(200);
  return res.body.authorizationUrl as string;
}

function callback(query: string, cookie: string): request.Test {
  return http().get(`${CALLBACK}?${query}`).set('Cookie', cookie);
}

/** Issue lue dans la redirection vers la page de retour du web. */
function outcome(res: request.Response): { status: string | null; error: string | null } {
  expect(res.status).toBe(303);
  const location = new URL(res.headers.location as string);
  expect(`${location.origin}${location.pathname}`).toBe(RETURN);
  return { status: location.searchParams.get('status'), error: location.searchParams.get('error') };
}

function signedFrom(res: request.Response, accountId: string): SignedIn {
  const token = cookieValue(res, SESSION_COOKIE);
  if (!token) throw new Error('Pas de cookie de session');
  const tokenHash = app.get(SecretTokens).hash(token);
  const row = [...identity.sessions.rows.values()].find((r) => r.tokenHash === tokenHash);
  if (!row) throw new Error('Session absente');
  return sessionHeaders(app, token, tokenHash, row.id, accountId, null);
}

function accountOf(subject: string): string {
  const accountId = identity.googleIdentities.identities.get(subject);
  if (!accountId) throw new Error('Identité absente');
  return accountId;
}

/** Inscription complète par Google ; renvoie la session ouverte. */
async function googleSignUp(
  subject: string,
  email = `${subject}@gmail.test`,
): Promise<{ accountId: string; user: SignedIn }> {
  const pre = await presession();
  const url = await startLogin(pre, REGISTRATION);
  const res = await callback(
    identity.google.approve(url, { subject, email }),
    pre.headers.Cookie ?? '',
  );
  expect(outcome(res)).toEqual({ status: 'signed_in', error: null });
  const accountId = accountOf(subject);
  return { accountId, user: signedFrom(res, accountId) };
}

/** Connexion par Google d'un compte déjà associé. */
async function googleLogin(
  subject: string,
  extraCookie = '',
): Promise<{ res: request.Response; pre: Presession }> {
  const pre = await presession();
  const url = await startLogin(pre);
  const res = await callback(
    identity.google.approve(url, { subject }),
    `${pre.headers.Cookie ?? ''}${extraCookie}`,
  );
  return { res, pre };
}

/** Compte vérifié, avec mot de passe. */
async function passwordAccount(
  emailVerifiedAt: Date | null = new Date(),
): Promise<{ email: string; accountId: string }> {
  const email = `t-${randomUUID()}@lahotte.test`;
  const accountId = randomUUID();
  identity.accounts.seed({
    id: accountId,
    email,
    passwordHash: await identity.hasher.hash(PASSWORD),
    emailVerifiedAt,
  });
  return { email, accountId };
}

async function passwordLogin(email: string, accountId: string): Promise<SignedIn> {
  const res = await http()
    .post('/api/v1/auth/login')
    .set((await presession()).headers)
    .send({ email, password: PASSWORD })
    .expect(200);
  const token = cookieValue(res, SESSION_COOKIE) ?? '';
  const row = identity.sessions.rows.get(res.body.session.id as string);
  if (!row) throw new Error('Session absente');
  return sessionHeaders(app, token, row.tokenHash, row.id, accountId, null);
}

async function passwordReauth(user: SignedIn, code?: string): Promise<SignedIn> {
  const res = await http()
    .post('/api/v1/auth/reauth')
    .set(user.mutation)
    .send(code ? { password: PASSWORD, code } : { password: PASSWORD })
    .expect(200);
  return signedFrom(res, user.accountId);
}

/** Association par les routes réelles ; renvoie la session (ré-authentifiée) qui l'a faite. */
async function link(user: SignedIn, subject: string): Promise<SignedIn> {
  const fresh = await passwordReauth(user);
  const started = await http().post('/api/v1/auth/google/link').set(fresh.mutation).expect(200);
  const res = await callback(
    identity.google.approve(started.body.authorizationUrl as string, { subject }),
    fresh.cookie,
  );
  expect(outcome(res)).toEqual({ status: 'linked', error: null });
  return fresh;
}

async function totp(secret: string, steps = 0): Promise<string> {
  return generate({ secret, epoch: Math.floor(Date.now() / 1000) + steps * 30 });
}

/** TOTP activé par les routes réelles ; renvoie le secret et la session neuve. */
async function enableTotp(user: SignedIn): Promise<{ secret: string; user: SignedIn }> {
  const fresh = await passwordReauth(user);
  const enrolled = await http().post('/api/v1/auth/totp/enroll').set(fresh.mutation).expect(200);
  const secret = enrolled.body.secret as string;
  const activated = await http()
    .post('/api/v1/auth/totp/activate')
    .set(fresh.mutation)
    .send({ code: await totp(secret) })
    .expect(200);
  identity.secondFactors.lastSteps.delete(user.accountId);
  return { secret, user: signedFrom(activated, user.accountId) };
}

const subject = (): string => `g-${randomUUID()}`;

describe('POST /auth/google/start (ADR 0013)', () => {
  it('URL de Google ; state, nonce et vérificateur PKCE gardés côté serveur seulement', async () => {
    const pre = await presession();
    const res = await http()
      .post('/api/v1/auth/google/start')
      .set(pre.headers)
      .send({})
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const url = new URL(res.body.authorizationUrl as string);
    const state = url.searchParams.get('state') ?? '';
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Ni nonce ni vérificateur dans la réponse au client : seulement dans l'URL de Google (le
    // défi PKCE, pas le vérificateur).
    const sent = identity.google.authorizations.get(state);
    expect(sent).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain(sent?.nonce ?? '-');
    // Clé du parcours : hash de `state`, jamais `state` en clair.
    expect(identity.oidcFlows.entries.has(state)).toBe(false);
    expect(identity.oidcFlows.entries.has(app.get(SecretTokens).hash(state))).toBe(true);
  });

  it('API-21 : sans jeton CSRF, refusé', async () => {
    const pre = await presession();
    await http()
      .post('/api/v1/auth/google/start')
      .set({ Cookie: pre.headers.Cookie ?? '', Origin: WEB_ORIGIN })
      .send({})
      .expect(403);
  });

  it('AUTH-08 : inscription sans déclaration d’âge refusée par la validation', async () => {
    const pre = await presession();
    await http()
      .post('/api/v1/auth/google/start')
      .set(pre.headers)
      .send({ registration: { displayName: 'Camille', ageAttested: false } })
      .expect(400);
  });

  it('Google non configuré : 503 GOOGLE_UNAVAILABLE', async () => {
    identity.google.enabled = false;
    const res = await http()
      .post('/api/v1/auth/google/start')
      .set((await presession()).headers)
      .send({})
      .expect(503);
    expect(res.body.code).toBe('GOOGLE_UNAVAILABLE');
  });

  it('`01` « Limitation » : 30 démarrages par heure et par IP, puis 429', async () => {
    const pre = await presession();
    for (let i = 0; i < 30; i += 1) {
      await http().post('/api/v1/auth/google/start').set(pre.headers).send({}).expect(200);
    }
    await http().post('/api/v1/auth/google/start').set(pre.headers).send({}).expect(429);
  });

  it('depuis une session sans pré-session : une pré-session est posée, le jeton CSRF reste celui de la session', async () => {
    const { email, accountId } = await passwordAccount();
    const user = await passwordLogin(email, accountId);
    const res = await http()
      .post('/api/v1/auth/google/start')
      .set(user.mutation)
      .send({})
      .expect(200);
    expect(cookieValue(res, PRESESSION_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookieValue(res, '__Host-lh_csrf')).toBeNull();
  });
});

describe('Retour de Google : protections (ADR 0013, « Retour OIDC »)', () => {
  it('redirection 303 vers la page de retour, sans cache ni Referer, sans code ni state', async () => {
    const pre = await presession();
    const url = await startLogin(pre, REGISTRATION);
    const query = identity.google.approve(url, { subject: subject() });
    const res = await callback(query, pre.headers.Cookie ?? '');
    expect(outcome(res).status).toBe('signed_in');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const location = res.headers.location as string;
    for (const value of new URLSearchParams(query).values()) {
      expect(location).not.toContain(value);
    }
  });

  it('state à usage unique : un retour rejoué est refusé', async () => {
    const pre = await presession();
    const url = await startLogin(pre, REGISTRATION);
    const query = identity.google.approve(url, { subject: subject() });
    expect(outcome(await callback(query, pre.headers.Cookie ?? '')).status).toBe('signed_in');
    const replay = await callback(query, pre.headers.Cookie ?? '');
    expect(outcome(replay)).toEqual({ status: null, error: 'GOOGLE_FLOW_INVALID' });
    expect(cookieValue(replay, SESSION_COOKIE)).toBeNull();
  });

  it('CSRF de connexion : le retour d’un tiers présenté dans une autre pré-session est refusé, et brûlé', async () => {
    const attacker = await presession();
    const url = await startLogin(attacker, REGISTRATION);
    const sub = subject();
    const query = identity.google.approve(url, { subject: sub });
    const victim = await presession();
    const res = await callback(query, victim.headers.Cookie ?? '');
    expect(outcome(res)).toEqual({ status: null, error: 'GOOGLE_FLOW_INVALID' });
    expect(cookieValue(res, SESSION_COOKIE)).toBeNull();
    expect(identity.googleIdentities.identities.has(sub)).toBe(false);
    // Le parcours est consommé : même son auteur ne peut plus s'en servir.
    const again = await callback(query, attacker.headers.Cookie ?? '');
    expect(outcome(again).error).toBe('GOOGLE_FLOW_INVALID');
  });

  it('SEC-30, DAT-02 : un state inconnu n’écrit rien au journal de sécurité', async () => {
    const pre = await presession();
    const before = identity.securityLog.entries.length;
    for (let i = 0; i < 20; i += 1) {
      const state = Buffer.from(randomUUID() + randomUUID())
        .toString('base64url')
        .slice(0, 43);
      expect(outcome(await callback(`state=${state}&code=x`, pre.headers.Cookie ?? '')).error).toBe(
        'GOOGLE_FLOW_INVALID',
      );
    }
    expect(identity.securityLog.entries.length).toBe(before);
  });

  it('AUTH-03 : le choix du compte Google est toujours demandé', async () => {
    const url = new URL(await startLogin(await presession()));
    expect(url.searchParams.get('state')).not.toBeNull();
    // Le fournisseur simulé ne recopie pas `prompt` : vérifié sur l'adaptateur réel.
  });

  it('sans pré-session, ou avec un state inconnu ou mal formé : refusé', async () => {
    const pre = await presession();
    const url = await startLogin(pre, REGISTRATION);
    const query = identity.google.approve(url, { subject: subject() });
    expect(outcome(await callback(query, '')).error).toBe('GOOGLE_FLOW_INVALID');
    expect(outcome(await callback('state=abc&code=def', pre.headers.Cookie ?? '')).error).toBe(
      'GOOGLE_FLOW_INVALID',
    );
    expect(outcome(await callback('', pre.headers.Cookie ?? '')).error).toBe('GOOGLE_FLOW_INVALID');
  });

  it('parcours expiré (10 minutes) : refusé', async () => {
    const pre = await presession();
    const url = await startLogin(pre, REGISTRATION);
    identity.oidcFlows.expireAll();
    const res = await callback(
      identity.google.approve(url, { subject: subject() }),
      pre.headers.Cookie ?? '',
    );
    expect(outcome(res).error).toBe('GOOGLE_FLOW_INVALID');
  });

  it('code d’un autre parcours (state, nonce, PKCE ne correspondent pas) : GOOGLE_REJECTED', async () => {
    const pre = await presession();
    const first = await startLogin(pre, REGISTRATION);
    const second = await startLogin(pre, REGISTRATION);
    const stateOfSecond = new URL(second).searchParams.get('state') ?? '';
    const codeOfFirst =
      new URLSearchParams(identity.google.approve(first, { subject: subject() })).get('code') ?? '';
    const res = await callback(
      `state=${stateOfSecond}&code=${codeOfFirst}`,
      pre.headers.Cookie ?? '',
    );
    expect(outcome(res).error).toBe('GOOGLE_REJECTED');
    expect(identity.securityLog.entries.at(-1)?.event).toBe('google.rejected');
  });

  it('annulation chez Google (error=access_denied) : GOOGLE_REJECTED, rien de créé', async () => {
    const pre = await presession();
    const url = await startLogin(pre, REGISTRATION);
    const state = new URL(url).searchParams.get('state') ?? '';
    const before = identity.accounts.rows.size;
    const res = await callback(`state=${state}&error=access_denied`, pre.headers.Cookie ?? '');
    expect(outcome(res).error).toBe('GOOGLE_REJECTED');
    expect(identity.accounts.rows.size).toBe(before);
  });

  it('Google injoignable : SERVICE_UNAVAILABLE', async () => {
    const pre = await presession();
    const url = await startLogin(pre, REGISTRATION);
    const query = identity.google.approve(url, { subject: subject() });
    identity.google.unreachable = true;
    expect(outcome(await callback(query, pre.headers.Cookie ?? '')).error).toBe(
      'SERVICE_UNAVAILABLE',
    );
  });
});

describe('Inscription et connexion par Google (AUTH-01, AUTH-03, AUTH-15)', () => {
  it('inscription : compte vérifié sans mot de passe, premier profil, session ouverte', async () => {
    const sub = subject();
    const { accountId, user } = await googleSignUp(sub, `Camille.${sub}@Gmail.test`);
    const summary = await http().get('/api/v1/account').set('Cookie', user.cookie).expect(200);
    expect(summary.body).toMatchObject({
      email: `camille.${sub}@gmail.test`,
      emailVerified: true,
      hasPassword: false,
      googleLinked: true,
    });
    const profiles = [...identity.accounts.profiles.values()].filter(
      (p) => p.accountId === accountId,
    );
    expect(profiles.map((p) => p.displayName)).toEqual(['Camille']);
    expect(identity.securityLog.entries.map((e) => e.event)).toContain('account.registered');
  });

  it('connexion d’un compte associé : même compte, ancienne session du navigateur révoquée', async () => {
    const sub = subject();
    const { accountId, user } = await googleSignUp(sub);
    const { res } = await googleLogin(sub, `; ${SESSION_COOKIE}=${user.token}`);
    expect(outcome(res).status).toBe('signed_in');
    expect(signedFrom(res, accountId).accountId).toBe(accountId);
    expect(identity.sessions.rows.has(user.sessionId)).toBe(false);
    expect(cookieValue(res, PRESESSION_COOKIE)).toBe('');
  });

  it('sans compte ni inscription demandée : GOOGLE_REGISTRATION_REQUIRED, rien de créé', async () => {
    const sub = subject();
    const { res } = await googleLogin(sub);
    expect(outcome(res).error).toBe('GOOGLE_REGISTRATION_REQUIRED');
    expect(identity.googleIdentities.identities.has(sub)).toBe(false);
  });

  it('AUTH-03 : adresse non vérifiée par Google, rien de créé ni remplacé', async () => {
    const { email, accountId } = await passwordAccount(null);
    const pre = await presession();
    const url = await startLogin(pre, REGISTRATION);
    const sub = subject();
    const res = await callback(
      identity.google.approve(url, { subject: sub, email, emailVerified: false }),
      pre.headers.Cookie ?? '',
    );
    expect(outcome(res).error).toBe('GOOGLE_EMAIL_UNVERIFIED');
    expect(identity.accounts.rows.has(accountId)).toBe(true);
    expect(identity.googleIdentities.identities.has(sub)).toBe(false);
  });

  it('AUTH-03 : jamais de fusion, même sur adresse vérifiée des deux côtés', async () => {
    const { email, accountId } = await passwordAccount();
    const pre = await presession();
    const url = await startLogin(pre, REGISTRATION);
    const sub = subject();
    const res = await callback(
      identity.google.approve(url, { subject: sub, email: email.toUpperCase() }),
      pre.headers.Cookie ?? '',
    );
    expect(outcome(res).error).toBe('GOOGLE_LINK_REQUIRED');
    expect(cookieValue(res, SESSION_COOKIE)).toBeNull();
    expect(identity.googleIdentities.identities.has(sub)).toBe(false);
    expect(await identity.googleIdentities.findSubject(accountId)).toBeNull();
  });

  it('AUTH-15 : un compte local non vérifié de même adresse est remplacé, ses sessions avec lui', async () => {
    const { email, accountId: squatter } = await passwordAccount(null);
    identity.accounts.profiles.set(randomUUID(), {
      id: randomUUID(),
      accountId: squatter,
      displayName: 'Proche',
      accentColor: '#000000',
      locale: 'fr',
      currency: 'EUR',
      timezone: 'Europe/Paris',
    });
    const sub = subject();
    const { accountId } = await googleSignUp(sub, email);
    expect(accountId).not.toBe(squatter);
    expect(identity.accounts.rows.has(squatter)).toBe(false);
    expect([...identity.accounts.profiles.values()].some((p) => p.accountId === squatter)).toBe(
      false,
    );
    expect(identity.securityLog.entries.map((e) => e.event)).toContain('account.replaced');
  });

  it('AUTH-15 : sans inscription demandée, le compte non vérifié n’est pas remplacé', async () => {
    const { email, accountId } = await passwordAccount(null);
    const pre = await presession();
    const url = await startLogin(pre);
    const res = await callback(
      identity.google.approve(url, { subject: subject(), email }),
      pre.headers.Cookie ?? '',
    );
    expect(outcome(res).error).toBe('GOOGLE_REGISTRATION_REQUIRED');
    expect(identity.accounts.rows.has(accountId)).toBe(true);
  });

  it('AUTH-09 : en INVITE_ONLY, inscription refusée ; un compte associé se connecte toujours', async () => {
    const sub = subject();
    await googleSignUp(sub);
    identity.settings.registrationMode = 'INVITE_ONLY';
    const pre = await presession();
    const url = await startLogin(pre, REGISTRATION);
    const res = await callback(
      identity.google.approve(url, { subject: subject() }),
      pre.headers.Cookie ?? '',
    );
    expect(outcome(res).error).toBe('INVITATION_REQUIRED');
    expect(outcome((await googleLogin(sub)).res).status).toBe('signed_in');
  });

  it('critère de 01 : compte créé par Google puis doté d’un mot de passe, même compte par les deux moyens', async () => {
    const sub = subject();
    const email = `${sub}@gmail.test`;
    const { accountId } = await googleSignUp(sub, email);
    // Le compte Google se donne un mot de passe par la réinitialisation (AUTH-03, AUTH-06).
    await http()
      .post('/api/v1/auth/password/reset')
      .set((await presession()).headers)
      .send({ email })
      .expect(202);
    await identity.background.flush();
    const token = identity.mail.lastToken(email);
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set((await presession()).headers)
      .send({ token, newPassword: PASSWORD })
      .expect(204);
    const byPassword = await passwordLogin(email, accountId);
    expect(identity.sessions.rows.get(byPassword.sessionId)?.accountId).toBe(accountId);
    const { res } = await googleLogin(sub);
    expect(outcome(res).status).toBe('signed_in');
    expect(signedFrom(res, accountId).accountId).toBe(accountId);
  });

  it('compte suspendu : ACCOUNT_SUSPENDED, aucune session', async () => {
    const sub = subject();
    const { accountId } = await googleSignUp(sub);
    identity.sessions.setActive(accountId, false);
    const { res } = await googleLogin(sub);
    expect(outcome(res).error).toBe('ACCOUNT_SUSPENDED');
    expect(cookieValue(res, SESSION_COOKIE)).toBeNull();
  });
});

describe('Second facteur après Google (AUTH-12, AUTH-13)', () => {
  it('TOTP actif : pré-authentification, puis session par le code', async () => {
    const { email, accountId } = await passwordAccount();
    const sub = subject();
    const linked = await link(await passwordLogin(email, accountId), sub);
    const { secret } = await enableTotp(linked);

    const { res, pre } = await googleLogin(sub);
    expect(outcome(res).status).toBe('second_factor');
    expect(cookieValue(res, SESSION_COOKIE)).toBeNull();
    const pending = cookieValue(res, PENDING_COOKIE) ?? '';
    expect(pending).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const verified = await http()
      .post('/api/v1/auth/totp/verify')
      .set({
        ...pre.headers,
        Cookie: `${PRESESSION_COOKIE}=${pre.id}; ${PENDING_COOKIE}=${pending}`,
      })
      .send({ code: await totp(secret, 1) })
      .expect(200);
    expect(verified.body.authenticated).toBe(true);
  });

  it('appareil de confiance du compte : dispense du code ; celui d’un autre compte, non', async () => {
    const { email, accountId } = await passwordAccount();
    const sub = subject();
    const { secret } = await enableTotp(await link(await passwordLogin(email, accountId), sub));
    const first = await googleLogin(sub);
    const pending = cookieValue(first.res, PENDING_COOKIE) ?? '';
    const trusted = await http()
      .post('/api/v1/auth/totp/verify')
      .set({
        ...first.pre.headers,
        Cookie: `${PRESESSION_COOKIE}=${first.pre.id}; ${PENDING_COOKIE}=${pending}`,
      })
      .send({ code: await totp(secret, 1), trustDevice: true })
      .expect(200);
    const device = cookieValue(trusted, DEVICE_COOKIE) ?? '';

    const dispensed = await googleLogin(sub, `; ${DEVICE_COOKIE}=${device}`);
    expect(outcome(dispensed.res).status).toBe('signed_in');

    const other = subject();
    await googleSignUp(other);
    const other2 = await passwordAccount();
    await enableTotp(await link(await passwordLogin(other2.email, other2.accountId), `${other}-x`));
    const notDispensed = await googleLogin(`${other}-x`, `; ${DEVICE_COOKIE}=${device}`);
    expect(outcome(notDispensed.res).status).toBe('second_factor');
  });

  it('AUTH-13 : modérateur sans TOTP, refus en échec fermé', async () => {
    const sub = subject();
    const { accountId } = await googleSignUp(sub);
    const state = identity.sessions.accounts.get(accountId);
    if (!state) throw new Error('Compte absent');
    state.role = 'MODERATOR';
    const { res } = await googleLogin(sub);
    expect(outcome(res).error).toBe('TOTP_ENROLLMENT_REQUIRED');
    expect(cookieValue(res, SESSION_COOKIE)).toBeNull();
  });
});

describe('Association (AUTH-03, AUTH-14, AUTH-15)', () => {
  it('exige une ré-authentification récente', async () => {
    const { email, accountId } = await passwordAccount();
    const user = await passwordLogin(email, accountId);
    const res = await http().post('/api/v1/auth/google/link').set(user.mutation).expect(401);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
  });

  it('associe le compte Google ; avis à l’adresse du compte ; connexion par Google ensuite', async () => {
    const { email, accountId } = await passwordAccount();
    const sub = subject();
    const user = await link(await passwordLogin(email, accountId), sub);
    expect(await identity.googleIdentities.findSubject(accountId)).toBe(sub);
    await identity.background.flush();
    expect(identity.mail.sent.at(-1)).toMatchObject({
      to: email,
      subject: 'Compte Google associé',
    });
    const summary = await http().get('/api/v1/account').set('Cookie', user.cookie).expect(200);
    expect(summary.body.googleLinked).toBe(true);
    const { res } = await googleLogin(sub);
    expect(signedFrom(res, accountId).accountId).toBe(accountId);
  });

  it('retour présenté dans une autre session : refusé, rien d’associé', async () => {
    const { email, accountId } = await passwordAccount();
    const fresh = await passwordReauth(await passwordLogin(email, accountId));
    const started = await http().post('/api/v1/auth/google/link').set(fresh.mutation).expect(200);
    const other = await passwordAccount();
    const otherUser = await passwordLogin(other.email, other.accountId);
    const sub = subject();
    const res = await callback(
      identity.google.approve(started.body.authorizationUrl as string, { subject: sub }),
      otherUser.cookie,
    );
    expect(outcome(res).error).toBe('GOOGLE_FLOW_INVALID');
    expect(identity.googleIdentities.identities.has(sub)).toBe(false);
  });

  it('ADR 0014 : une époque changée entre le départ et le retour annule l’association', async () => {
    const { email, accountId } = await passwordAccount();
    const fresh = await passwordReauth(await passwordLogin(email, accountId));
    const started = await http().post('/api/v1/auth/google/link').set(fresh.mutation).expect(200);
    const changed = await http()
      .put('/api/v1/auth/password')
      .set(fresh.mutation)
      .send({ newPassword: 'une toute autre phrase de passe' })
      .expect(200);
    const renewed = signedFrom(changed, accountId);
    const sub = subject();
    const res = await callback(
      identity.google.approve(started.body.authorizationUrl as string, { subject: sub }),
      renewed.cookie,
    );
    expect(outcome(res).error).toBe('GOOGLE_FLOW_INVALID');
    expect(identity.googleIdentities.identities.has(sub)).toBe(false);
  });

  it('AUTH-14 : ré-authentification perdue entre le départ et le retour (verrouillage, délai) : rien d’associé', async () => {
    const { email, accountId } = await passwordAccount();
    const fresh = await passwordReauth(await passwordLogin(email, accountId));
    const started = await http().post('/api/v1/auth/google/link').set(fresh.mutation).expect(200);
    // Ré-authentification effacée (verrouillage, changement de profil) ou trop ancienne.
    const stale = new Date(Date.now() - 11 * 60_000);
    const row = identity.sessions.rows.get(fresh.sessionId);
    if (row) identity.sessions.rows.set(fresh.sessionId, { ...row, reauthAt: stale });
    const cached = identity.sessions.cache.get(fresh.tokenHash);
    if (cached) {
      identity.sessions.cache.set(fresh.tokenHash, {
        ...cached,
        record: { ...cached.record, reauthAt: stale },
      });
    }
    const sub = subject();
    const res = await callback(
      identity.google.approve(started.body.authorizationUrl as string, { subject: sub }),
      fresh.cookie,
    );
    expect(outcome(res).error).toBe('REAUTH_REQUIRED');
    expect(identity.googleIdentities.identities.has(sub)).toBe(false);
  });

  it('compte Google déjà associé à un autre compte : GOOGLE_IDENTITY_TAKEN', async () => {
    const sub = subject();
    await googleSignUp(sub);
    const { email, accountId } = await passwordAccount();
    const fresh = await passwordReauth(await passwordLogin(email, accountId));
    const started = await http().post('/api/v1/auth/google/link').set(fresh.mutation).expect(200);
    const res = await callback(
      identity.google.approve(started.body.authorizationUrl as string, { subject: sub }),
      fresh.cookie,
    );
    expect(outcome(res).error).toBe('GOOGLE_IDENTITY_TAKEN');
    expect(await identity.googleIdentities.findSubject(accountId)).toBeNull();
  });

  it('déjà associé : 409 au départ', async () => {
    const { email, accountId } = await passwordAccount();
    const user = await link(await passwordLogin(email, accountId), subject());
    const res = await http().post('/api/v1/auth/google/link').set(user.mutation).expect(409);
    expect(res.body.code).toBe('GOOGLE_ALREADY_LINKED');
  });

  it('AUTH-15 : compte non vérifié, refusé au départ', async () => {
    const { accountId } = await passwordAccount(null);
    // Session ouverte par le cycle de vie (un compte non vérifié ne se connecte pas par mot de
    // passe) : le refus vient de la règle, pas de la connexion.
    const user = await passwordReauth(await signIn(app, { accountId }));
    const res = await http().post('/api/v1/auth/google/link').set(user.mutation).expect(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

describe('Ré-authentification par Google (AUTH-14)', () => {
  async function googleUser(): Promise<{ sub: string; accountId: string; user: SignedIn }> {
    const sub = subject();
    const { accountId, user } = await googleSignUp(sub);
    return { sub, accountId, user };
  }

  async function startReauth(user: SignedIn): Promise<string> {
    const res = await http().post('/api/v1/auth/google/reauth').set(user.mutation).expect(200);
    const url = res.body.authorizationUrl as string;
    expect(new URL(url).searchParams.get('max_age')).toBe('0');
    return url;
  }

  it('sans TOTP : session tournée, ré-authentification posée', async () => {
    const { sub, accountId, user } = await googleUser();
    const res = await callback(
      identity.google.approve(await startReauth(user), { subject: sub }),
      user.cookie,
    );
    expect(outcome(res).status).toBe('reauthenticated');
    const renewed = signedFrom(res, accountId);
    expect(renewed.sessionId).toBe(user.sessionId);
    expect(identity.sessions.rows.get(renewed.sessionId)?.reauthAt).not.toBeNull();
    // Ancien jeton refusé (rotation).
    await http().get('/api/v1/account').set('Cookie', user.cookie).expect(401);
    // Une action AUTH-14 passe.
    await http().post('/api/v1/auth/totp/enroll').set(renewed.mutation).expect(200);
  });

  it('authentification non fraîche chez Google : GOOGLE_REJECTED', async () => {
    const { sub, user } = await googleUser();
    const res = await callback(
      identity.google.approve(await startReauth(user), { subject: sub }, { freshAuth: false }),
      user.cookie,
    );
    expect(outcome(res).error).toBe('GOOGLE_REJECTED');
  });

  it('AUTH-14 : authentification Google antérieure au départ du parcours : GOOGLE_REJECTED', async () => {
    const { sub, user } = await googleUser();
    const url = await startReauth(user);
    // Acceptée par Google comme fraîche (moins de 5 minutes), mais faite avant le départ.
    const res = await callback(
      identity.google.approve(url, { subject: sub }, { authTime: new Date(Date.now() - 120_000) }),
      user.cookie,
    );
    expect(outcome(res).error).toBe('GOOGLE_REJECTED');
    expect(identity.sessions.rows.get(user.sessionId)?.reauthAt).toBeNull();
  });

  it('un autre compte Google que celui associé : GOOGLE_IDENTITY_MISMATCH', async () => {
    const { user } = await googleUser();
    const res = await callback(
      identity.google.approve(await startReauth(user), { subject: subject() }),
      user.cookie,
    );
    expect(outcome(res).error).toBe('GOOGLE_IDENTITY_MISMATCH');
    expect(identity.sessions.rows.get(user.sessionId)?.reauthAt).toBeNull();
  });

  it('aucun compte Google associé : 422 au départ', async () => {
    const { email, accountId } = await passwordAccount();
    const user = await passwordLogin(email, accountId);
    const res = await http().post('/api/v1/auth/google/reauth').set(user.mutation).expect(422);
    expect(res.body.code).toBe('GOOGLE_NOT_LINKED');
  });

  it('avec TOTP : le retour attend le code ; un code faux ne fait pas repasser par Google', async () => {
    const { email, accountId } = await passwordAccount();
    const sub = subject();
    const { secret, user } = await enableTotp(
      await link(await passwordLogin(email, accountId), sub),
    );
    const res = await callback(
      identity.google.approve(await startReauth(user), { subject: sub }),
      user.cookie,
    );
    expect(outcome(res).status).toBe('reauth_second_factor');
    expect(cookieValue(res, SESSION_COOKIE)).toBeNull();

    await http().post('/api/v1/auth/reauth').set(user.mutation).send({}).expect(422);
    const wrong = await http()
      .post('/api/v1/auth/reauth')
      .set(user.mutation)
      .send({ code: '000000' })
      .expect(401);
    expect(wrong.body.code).toBe('INVALID_SECOND_FACTOR');
    const ok = await http()
      .post('/api/v1/auth/reauth')
      .set(user.mutation)
      .send({ code: await totp(secret, 1) })
      .expect(200);
    const renewed = signedFrom(ok, accountId);
    // Preuve consommée : elle ne sert pas une seconde fois.
    identity.secondFactors.lastSteps.delete(accountId);
    await http()
      .post('/api/v1/auth/reauth')
      .set(renewed.mutation)
      .send({ code: await totp(secret, -1) })
      .expect(401);
  });

  it('AUTH-14 : la preuve Google ne survit pas au verrouillage', async () => {
    const { email, accountId } = await passwordAccount();
    const sub = subject();
    const { secret, user } = await enableTotp(
      await link(await passwordLogin(email, accountId), sub),
    );
    await callback(identity.google.approve(await startReauth(user), { subject: sub }), user.cookie);
    expect(identity.googleReauthProofs.entries.has(user.sessionId)).toBe(true);
    await app
      .get(SessionLifecycle)
      .lock({ id: user.sessionId, accountId, tokenHash: user.tokenHash }, null);
    expect(identity.googleReauthProofs.entries.has(user.sessionId)).toBe(false);
    await http()
      .post('/api/v1/auth/reauth')
      .set(user.mutation)
      .send({ code: await totp(secret, 1) })
      .expect(401);
  });

  it('sans mot de passe ni preuve Google : refusé', async () => {
    const { user } = await googleUser();
    const res = await http().post('/api/v1/auth/reauth').set(user.mutation).send({}).expect(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('preuve liée à la session qui a fait le passage : inutilisable par une autre', async () => {
    const { email, accountId } = await passwordAccount();
    const sub = subject();
    const { secret, user } = await enableTotp(
      await link(await passwordLogin(email, accountId), sub),
    );
    await callback(identity.google.approve(await startReauth(user), { subject: sub }), user.cookie);
    // Autre session du même compte (le TOTP actif impose sinon la pré-authentification).
    const otherSession = await signIn(app, { accountId });
    await http()
      .post('/api/v1/auth/reauth')
      .set(otherSession.mutation)
      .send({ code: await totp(secret, 1) })
      .expect(401);
  });
});

describe('Dissociation (AUTH-03, AUTH-05, AUTH-14)', () => {
  it('sans mot de passe : refusée sans déconnecter personne', async () => {
    const sub = subject();
    const { accountId, user } = await googleSignUp(sub);
    const res = await callback(
      identity.google.approve(
        (await http().post('/api/v1/auth/google/reauth').set(user.mutation).expect(200)).body
          .authorizationUrl as string,
        { subject: sub },
      ),
      user.cookie,
    );
    const fresh = signedFrom(res, accountId);
    const refused = await http().delete('/api/v1/auth/google').set(fresh.mutation).expect(422);
    expect(refused.body.code).toBe('PASSWORD_REQUIRED');
    await http().get('/api/v1/account').set('Cookie', fresh.cookie).expect(200);
  });

  it('exige une ré-authentification récente', async () => {
    const { email, accountId } = await passwordAccount();
    await link(await passwordLogin(email, accountId), subject());
    const user = await passwordLogin(email, accountId);
    const res = await http().delete('/api/v1/auth/google').set(user.mutation).expect(401);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
  });

  it('révoque toutes les sessions, y compris celles ouvertes par Google ; session neuve pour l’appelant', async () => {
    const { email, accountId } = await passwordAccount();
    const sub = subject();
    const owner = await link(await passwordLogin(email, accountId), sub);
    const { res: byGoogle } = await googleLogin(sub);
    const relative = signedFrom(byGoogle, accountId);

    const unlinked = await http().delete('/api/v1/auth/google').set(owner.mutation).expect(200);
    const renewed = signedFrom(unlinked, accountId);
    await http().get('/api/v1/account').set('Cookie', relative.cookie).expect(401);
    await http().get('/api/v1/account').set('Cookie', owner.cookie).expect(401);
    const summary = await http().get('/api/v1/account').set('Cookie', renewed.cookie).expect(200);
    expect(summary.body.googleLinked).toBe(false);
    await identity.background.flush();
    expect(identity.mail.sent.at(-1)).toMatchObject({
      to: email,
      subject: 'Compte Google dissocié',
    });

    // Le compte Google ne mène plus à ce compte.
    const { res } = await googleLogin(sub);
    expect(outcome(res).error).toBe('GOOGLE_REGISTRATION_REQUIRED');
  });
});
