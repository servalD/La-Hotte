import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PurgeUnverifiedAccounts } from '../../src/modules/identity/application/purge-unverified-accounts.use-case';
import {
  CSRF_COOKIE,
  PRESESSION_COOKIE,
  SESSION_COOKIE,
} from '../../src/modules/identity/presentation/cookies';
import {
  signIn as openSession,
  session as sessionHeaders,
  type SignedIn,
  WEB_ORIGIN,
} from '../support/sign-in';
import { createTestApp, type TestIdentity } from './create-test-app';

// Comptes par mot de passe (AUTH-01, 02, 05, 06, 07, 08, 09, 14, 15, 16 ; PRO-01 ; ADR 0013, 0014).

let app: INestApplication;
let identity: TestIdentity;
/** Pré-session partagée par les helpers synchrones (son jeton CSRF ne change pas). */
let pre: Record<string, string>;

beforeAll(async () => {
  ({ app, identity } = await createTestApp());
  pre = await presession();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
  identity.settings.registrationMode = 'OPEN';
});

const http = () => request(app.getHttpServer());
const PASSWORD = 'une phrase de passe assez longue';

function cookiesOf(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function cookieValue(res: request.Response, name: string): string | null {
  const found = cookiesOf(res).find((c) => c.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.split(';')[0]?.slice(name.length + 1) ?? '') : null;
}

/** En-têtes d'une mutation avant session : pré-session et son jeton CSRF (ADR 0013). */
async function presession(): Promise<Record<string, string>> {
  const res = await http().get('/api/v1/session').expect(200);
  const id = cookieValue(res, PRESESSION_COOKIE) ?? '';
  return {
    Cookie: `${PRESESSION_COOKIE}=${id}`,
    'X-CSRF-Token': res.body.csrfToken as string,
    Origin: WEB_ORIGIN,
  };
}

function email(): string {
  return `p-${randomUUID()}@lahotte.test`;
}

function register(address: string, password = PASSWORD): request.Test {
  return http()
    .post('/api/v1/auth/register')
    .set(pre)
    .send({ email: address, password, displayName: 'Camille', ageAttested: true });
}

/** Compte inscrit puis vérifié par le lien reçu. */
async function verifiedAccount(password = PASSWORD): Promise<{ email: string; accountId: string }> {
  const address = email();
  await register(address, password).expect(202);
  await identity.background.flush();
  const token = identity.mail.lastToken(address);
  await http()
    .post('/api/v1/auth/email/verify')
    .set(await presession())
    .send({ token })
    .expect(204);
  const account = await identity.accounts.findByEmail(address);
  if (!account) throw new Error('Compte absent');
  return { email: address, accountId: account.accountId };
}

/** Connexion par la route réelle ; en-têtes de la session ouverte. */
async function login(address: string, password = PASSWORD): Promise<SignedIn> {
  const res = await http()
    .post('/api/v1/auth/login')
    .set(await presession())
    .send({ email: address, password })
    .expect(200);
  const token = cookieValue(res, SESSION_COOKIE) ?? '';
  const sessionId = res.body.session.id as string;
  const row = identity.sessions.rows.get(sessionId);
  if (!row) throw new Error('Session absente');
  return sessionHeaders(app, token, row.tokenHash, sessionId, row.accountId, null);
}

async function reauth(user: SignedIn, password = PASSWORD): Promise<SignedIn> {
  const res = await http()
    .post('/api/v1/auth/reauth')
    .set(user.mutation)
    .send({ password })
    .expect(200);
  const token = cookieValue(res, SESSION_COOKIE) ?? '';
  const row = identity.sessions.rows.get(user.sessionId);
  if (!row) throw new Error('Session absente');
  return sessionHeaders(app, token, row.tokenHash, user.sessionId, user.accountId, null);
}

describe('POST /auth/register (AUTH-01, AUTH-08, AUTH-09, PRO-01)', () => {
  it('crée un compte non vérifié et son premier profil ; lien dans le fragment ; aucune session', async () => {
    const address = email();
    const res = await register(address.toUpperCase()).expect(202);
    expect(res.text).toBe('');
    expect(cookiesOf(res).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);

    await identity.background.flush();
    const account = await identity.accounts.findByEmail(address);
    expect(account).toMatchObject({ emailVerified: false, active: true });
    const profiles = [...identity.accounts.profiles.values()].filter(
      (p) => p.accountId === account?.accountId,
    );
    expect(profiles).toEqual([
      expect.objectContaining({ displayName: 'Camille', locale: 'fr', currency: 'EUR' }),
    ]);
    const mail = identity.mail.sent.at(-1);
    expect(mail?.to).toBe(address);
    // ADR 0013 : jeton dans le fragment, jamais dans une chaîne de requête.
    expect(mail?.text).toMatch(/http:\/\/localhost:3000\/auth\/verify-email#[A-Za-z0-9_-]{43}/);
    expect(mail?.text).not.toContain('?');
    // Le mot de passe n'est stocké que haché.
    expect(identity.accounts.rows.get(account?.accountId ?? '')?.passwordHash).not.toContain(
      PASSWORD,
    );
  });

  it('critère de 01 : adresse déjà inscrite — même réponse, aucun compte créé, titulaire averti', async () => {
    const { email: address } = await verifiedAccount();
    const accountsBefore = identity.accounts.rows.size;

    const fresh = await register(email()).expect(202);
    const taken = await register(address).expect(202);
    // Même statut, même corps, mêmes cookies posés.
    expect(taken.text).toBe(fresh.text);
    expect(cookiesOf(taken).map((c) => c.split('=')[0])).toEqual(
      cookiesOf(fresh).map((c) => c.split('=')[0]),
    );

    await identity.background.flush();
    // Seule l'inscription nouvelle a créé un compte.
    expect(identity.accounts.rows.size).toBe(accountsBefore + 1);
    const warning = identity.mail.sent.filter((m) => m.to === address).at(-1);
    expect(warning?.subject).toBe('Tentative d’inscription avec votre adresse');
    expect(warning?.text).not.toMatch(/#[A-Za-z0-9_-]{43}/);
  });

  it('AUTH-02 : le hachage a lieu même pour une adresse prise (même délai)', async () => {
    const { email: address } = await verifiedAccount();
    const spy = vi.spyOn(identity.hasher, 'hash');
    await register(address).expect(202);
    await register(email()).expect(202);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('AUTH-08 : la déclaration d’âge est obligatoire et ne vaut que `true`', async () => {
    for (const ageAttested of [false, 'true', undefined]) {
      await http()
        .post('/api/v1/auth/register')
        .set(await presession())
        .send({ email: email(), password: PASSWORD, displayName: 'Camille', ageAttested })
        .expect(400);
    }
  });

  it('AUTH-02 : trop court refusé (400), fuite connue refusée (422), sans rien créer', async () => {
    await register(email(), 'court').expect(400);
    const address = email();
    const res = await register(address, 'motdepasse123').expect(422);
    expect(res.body).toMatchObject({ code: 'PASSWORD_BREACHED' });
    await identity.background.flush();
    expect(await identity.accounts.findByEmail(address)).toBeNull();
  });

  it('critère de 01 : en INVITE_ONLY, une inscription sans invitation est refusée', async () => {
    identity.settings.registrationMode = 'INVITE_ONLY';
    const res = await register(email()).expect(403);
    expect(res.body).toMatchObject({ code: 'INVITATION_REQUIRED' });
  });

  it('champs inconnus refusés (SEC-10), CSRF de pré-session exigé', async () => {
    await http()
      .post('/api/v1/auth/register')
      .set(await presession())
      .send({
        email: email(),
        password: PASSWORD,
        displayName: 'C',
        ageAttested: true,
        role: 'ADMIN',
      })
      .expect(400);
    await http()
      .post('/api/v1/auth/register')
      .set({ Origin: WEB_ORIGIN })
      .send({ email: email(), password: PASSWORD, displayName: 'C', ageAttested: true })
      .expect(403);
  });

  it('limitation par IP : 429 au-delà de 10 demandes, avec Retry-After', async () => {
    for (let i = 0; i < 10; i += 1) await register(email()).expect(202);
    const res = await register(email()).expect(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('quota par destinataire : au-delà de 3 e-mails, rien ne part et la réponse ne change pas', async () => {
    const { email: address } = await verifiedAccount();
    const before = identity.mail.sent.filter((m) => m.to === address).length;
    for (let i = 0; i < 5; i += 1) await register(address).expect(202);
    await identity.background.flush();
    const after = identity.mail.sent.filter((m) => m.to === address).length;
    // Quota par sorte d'e-mail : trois avertissements au plus (la vérification compte à part).
    expect(after - before).toBe(3);
  });
});

describe('POST /auth/email/verify (AUTH-15)', () => {
  it('vérifie l’adresse sans ouvrir de session ; le lien ne sert qu’une fois ; jeton mal formé refusé', async () => {
    const address = email();
    await register(address).expect(202);
    await identity.background.flush();
    const token = identity.mail.lastToken(address);
    const res = await http()
      .post('/api/v1/auth/email/verify')
      .set(await presession())
      .send({ token })
      .expect(204);
    expect(cookiesOf(res).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    expect((await identity.accounts.findByEmail(address))?.emailVerified).toBe(true);
    // Le titulaire se connecte ensuite avec son mot de passe.
    await login(address);
    const again = await http()
      .post('/api/v1/auth/email/verify')
      .set(await presession())
      .send({ token })
      .expect(422);
    expect(again.body).toMatchObject({ code: 'TOKEN_INVALID' });
    await http()
      .post('/api/v1/auth/email/verify')
      .set(await presession())
      .send({ token: 'x'.repeat(10) })
      .expect(400);
  });

  it('revue cycle 2 (C2-B1) : inscription par un tiers, lien cliqué par le titulaire — pas de session ; la réinitialisation évince le tiers', async () => {
    const address = email();
    // Un proche inscrit l'adresse avec son mot de passe à lui.
    await register(address, 'mot de passe du proche').expect(202);
    await identity.background.flush();
    const res = await http()
      .post('/api/v1/auth/email/verify')
      .set(await presession())
      .send({ token: identity.mail.lastToken(address) })
      .expect(204);
    expect(cookiesOf(res).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);

    // Le titulaire ne connaît pas le mot de passe : il réinitialise ; le proche est évincé.
    await http()
      .post('/api/v1/auth/password/reset')
      .set(await presession())
      .send({ email: address })
      .expect(202);
    await identity.background.flush();
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set(await presession())
      .send({ token: identity.mail.lastToken(address), newPassword: 'la phrase du titulaire' })
      .expect(204);
    await http()
      .post('/api/v1/auth/login')
      .set(await presession())
      .send({ email: address, password: 'mot de passe du proche' })
      .expect(401);
    await login(address, 'la phrase du titulaire');
  });
});

describe('POST /auth/login (AUTH-07, ADR 0013, ADR 0014)', () => {
  it('ouvre une session : cookies __Host-, pré-session retirée, no-store, journal de sécurité', async () => {
    const { email: address, accountId } = await verifiedAccount();
    const res = await http()
      .post('/api/v1/auth/login')
      .set(await presession())
      .send({ email: ` ${address.toUpperCase()} `, password: PASSWORD })
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    // PRO-04 : le profil unique, créé à l'inscription, est sélectionné d'office.
    const [soleProfile] = [...identity.accounts.profiles.values()].filter(
      (p) => p.accountId === accountId,
    );
    expect(res.body).toMatchObject({
      authenticated: true,
      session: { activeProfileId: soleProfile?.id, profileUnlocked: true },
    });
    const sessionCookie = cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).toMatch(/Secure/);
    expect(cookieValue(res, CSRF_COOKIE)).toBe(res.body.csrfToken);
    expect(cookiesOf(res).some((c) => c.startsWith(`${PRESESSION_COOKIE}=;`))).toBe(true);
    expect(identity.securityLog.entries.at(-1)).toMatchObject({
      accountId,
      event: 'login.succeeded',
    });
  });

  it('AUTH-15, critère de 01 : compte non vérifié — même refus qu’une adresse déjà prise (pas de sonde inscription + connexion)', async () => {
    const { email: taken } = await verifiedAccount();
    const fresh = email();
    // Le sondeur s'inscrit avec son propre mot de passe, sur une adresse libre et sur une prise.
    await register(fresh, 'mot de passe du sondeur').expect(202);
    await register(taken, 'mot de passe du sondeur').expect(202);
    await identity.background.flush();
    const bodies: unknown[] = [];
    for (const who of [fresh, taken]) {
      const res = await http()
        .post('/api/v1/auth/login')
        .set(await presession())
        .send({ email: who, password: 'mot de passe du sondeur' })
        .expect(401);
      const { instance: _i, requestId: _r, ...body } = res.body as Record<string, unknown>;
      bodies.push(body);
    }
    expect(bodies[0]).toEqual(bodies[1]);
  });

  it('ADR 0014 : l’époque est lue avant le hash vérifié (I1, revue de la tranche 2)', async () => {
    const { email: address } = await verifiedAccount();
    const order: string[] = [];
    const realFindById = identity.accounts.findById.bind(identity.accounts);
    const realState = identity.sessions.accountState.bind(identity.sessions);
    const findById = vi.spyOn(identity.accounts, 'findById').mockImplementation((id) => {
      order.push('hash');
      return realFindById(id);
    });
    const accountState = vi.spyOn(identity.sessions, 'accountState').mockImplementation((id) => {
      order.push('epoch');
      return realState(id);
    });
    await http()
      .post('/api/v1/auth/login')
      .set(await presession())
      .send({ email: address, password: PASSWORD })
      .expect(200);
    findById.mockRestore();
    accountState.mockRestore();
    expect(order.indexOf('epoch')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('epoch')).toBeLessThan(order.indexOf('hash'));
  });

  it('critère de 01 : compte absent, sans mot de passe ou mot de passe faux — même refus, vérification factice', async () => {
    const { email: address } = await verifiedAccount();
    const googleOnly = email();
    identity.accounts.seed({ id: randomUUID(), email: googleOnly, passwordHash: null });

    const bodies: unknown[] = [];
    const dummyBefore = identity.hasher.dummyVerifications;
    for (const [who, password] of [
      [address, 'pas le bon mot de passe'],
      [email(), PASSWORD],
      [googleOnly, PASSWORD],
    ] as const) {
      const res = await http()
        .post('/api/v1/auth/login')
        .set(await presession())
        .send({ email: who, password })
        .expect(401);
      const { instance: _i, requestId: _r, ...body } = res.body as Record<string, unknown>;
      bodies.push(body);
    }
    expect(bodies[0]).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    // Compte absent et compte Google seul : une vérification de même coût a bien eu lieu.
    expect(identity.hasher.dummyVerifications - dummyBefore).toBe(2);
  });

  it('AUTH-07 : 5 échecs puis 429 sans évaluer les identifiants, compte existant ou non', async () => {
    const { email: address } = await verifiedAccount();
    for (const who of [address, email()]) {
      identity.rateLimiter.reset();
      for (let i = 0; i < 5; i += 1) {
        await http()
          .post('/api/v1/auth/login')
          .set(await presession())
          .send({ email: who, password: 'mauvais mot de passe' })
          .expect(401);
      }
      const verify = vi.spyOn(identity.hasher, 'verify');
      const res = await http()
        .post('/api/v1/auth/login')
        .set(await presession())
        // Même le bon mot de passe n'est pas évalué pendant le délai.
        .send({ email: who, password: PASSWORD })
        .expect(429);
      expect(verify).not.toHaveBeenCalled();
      verify.mockRestore();
      expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(res.headers['retry-after']).toBeDefined();
    }
  });

  it('rotation : se connecter depuis un navigateur qui a une session révoque l’ancienne', async () => {
    const { email: address } = await verifiedAccount();
    const first = await login(address);
    const second = await http()
      .post('/api/v1/auth/login')
      .set(first.mutation)
      .send({ email: address, password: PASSWORD })
      .expect(200);
    expect(second.body.session.id).not.toBe(first.sessionId);
    expect(identity.sessions.rows.has(first.sessionId)).toBe(false);
    await http().get('/api/v1/sessions').set('Cookie', first.cookie).expect(401);
  });

  it('CSRF de connexion : sans jeton de pré-session, refus', async () => {
    const { email: address } = await verifiedAccount();
    await http()
      .post('/api/v1/auth/login')
      .set({ Origin: WEB_ORIGIN })
      .send({ email: address, password: PASSWORD })
      .expect(403);
  });

  it('compte suspendu : refus après un mot de passe juste seulement', async () => {
    const { email: address, accountId } = await verifiedAccount();
    identity.sessions.setActive(accountId, false);
    const res = await http()
      .post('/api/v1/auth/login')
      .set(await presession())
      .send({ email: address, password: PASSWORD })
      .expect(403);
    expect(res.body).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    identity.sessions.setActive(accountId, true);
  });
});

describe('POST /auth/logout', () => {
  it('révoque la session et retire les cookies', async () => {
    const { email: address } = await verifiedAccount();
    const user = await login(address);
    const res = await http().post('/api/v1/auth/logout').set(user.mutation).expect(204);
    expect(cookiesOf(res).some((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
    await http().get('/api/v1/sessions').set('Cookie', user.cookie).expect(401);
  });
});

describe('Ré-authentification et changement de mot de passe (AUTH-05, AUTH-14)', () => {
  it('PUT /auth/password exige une ré-authentification récente', async () => {
    const { email: address } = await verifiedAccount();
    const user = await login(address);
    const res = await http()
      .put('/api/v1/auth/password')
      .set(user.mutation)
      .send({ newPassword: 'nouvelle phrase de passe' })
      .expect(401);
    expect(res.body).toMatchObject({ code: 'REAUTH_REQUIRED' });
  });

  it('ré-authentification : mauvais mot de passe 401 ; bon : nouveau jeton, ancien refusé', async () => {
    const { email: address } = await verifiedAccount();
    const user = await login(address);
    await http()
      .post('/api/v1/auth/reauth')
      .set(user.mutation)
      .send({ password: 'pas le bon mot de passe' })
      .expect(401);
    const fresh = await reauth(user);
    expect(fresh.token).not.toBe(user.token);
    await http().get('/api/v1/sessions').set('Cookie', user.cookie).expect(401);
    await http().get('/api/v1/sessions').set('Cookie', fresh.cookie).expect(200);
  });

  it('ré-authentification : 5 échecs puis 429 pour ce compte', async () => {
    const { email: address } = await verifiedAccount();
    const user = await login(address);
    for (let i = 0; i < 5; i += 1) {
      await http()
        .post('/api/v1/auth/reauth')
        .set(user.mutation)
        .send({ password: 'pas le bon mot de passe' })
        .expect(401);
    }
    await http()
      .post('/api/v1/auth/reauth')
      .set(user.mutation)
      .send({ password: PASSWORD })
      .expect(429);
  });

  it('critère de 01 : après changement, les autres sessions sont invalides ; l’appelant garde une session neuve', async () => {
    const { email: address, accountId } = await verifiedAccount();
    const other = await login(address);
    const user = await reauth(await login(address));

    const res = await http()
      .put('/api/v1/auth/password')
      .set(user.mutation)
      .send({ newPassword: 'nouvelle phrase de passe' })
      .expect(200);
    const token = cookieValue(res, SESSION_COOKIE);
    expect(token).not.toBe(user.token);
    expect(res.body.session.id).not.toBe(user.sessionId);

    await http().get('/api/v1/sessions').set('Cookie', other.cookie).expect(401);
    await http().get('/api/v1/sessions').set('Cookie', user.cookie).expect(401);
    await http()
      .get('/api/v1/sessions')
      .set('Cookie', `${SESSION_COOKIE}=${token ?? ''}`)
      .expect(200);
    expect(
      identity.securityLog.entries.some(
        (e) => e.accountId === accountId && e.event === 'password.changed',
      ),
    ).toBe(true);

    await http()
      .post('/api/v1/auth/login')
      .set(await presession())
      .send({ email: address, password: PASSWORD })
      .expect(401);
    await login(address, 'nouvelle phrase de passe');
  });
});

describe('Réinitialisation du mot de passe (AUTH-06)', () => {
  it('même réponse que l’adresse ait un compte ou non ; e-mail seulement s’il existe', async () => {
    const { email: address } = await verifiedAccount();
    const unknown = email();
    const known = await http()
      .post('/api/v1/auth/password/reset')
      .set(await presession())
      .send({ email: address })
      .expect(202);
    const absent = await http()
      .post('/api/v1/auth/password/reset')
      .set(await presession())
      .send({ email: unknown })
      .expect(202);
    expect(absent.text).toBe(known.text);
    await identity.background.flush();
    const reset = identity.mail.sent.filter((m) => m.to === address).at(-1);
    expect(reset?.text).toMatch(/\/auth\/reset-password#[A-Za-z0-9_-]{43}/);
    expect(identity.mail.sent.some((m) => m.to === unknown)).toBe(false);
  });

  it('critère de 01 : révoque toutes les sessions, y compris celle d’un tiers qui avait inscrit l’adresse', async () => {
    // Un tiers inscrit l'adresse de quelqu'un d'autre et y a une session (compte non vérifié :
    // pas de connexion par mot de passe, mais une session peut exister, par Google en tranche 4).
    const address = email();
    await register(address, 'mot de passe du tiers').expect(202);
    await identity.background.flush();
    const squatted = await identity.accounts.findByEmail(address);
    const intruder = await openSession(app, { accountId: squatted?.accountId ?? '' });

    // Le titulaire réinitialise : le lien prouve l'adresse.
    await http()
      .post('/api/v1/auth/password/reset')
      .set(await presession())
      .send({ email: address })
      .expect(202);
    await identity.background.flush();
    const token = identity.mail.lastToken(address);

    // Mot de passe trouvé dans une fuite : refusé, le lien reste utilisable.
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set(await presession())
      .send({ token, newPassword: 'password1234' })
      .expect(422);
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set(await presession())
      .send({ token, newPassword: 'la phrase du titulaire' })
      .expect(204);

    await http().get('/api/v1/sessions').set('Cookie', intruder.cookie).expect(401);
    const account = await identity.accounts.findByEmail(address);
    expect(account?.emailVerified).toBe(true);
    expect(identity.accounts.trustedDevicesRevokedAt.has(account?.accountId ?? '')).toBe(true);
    // Lien à usage unique.
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set(await presession())
      .send({ token, newPassword: 'encore une autre phrase' })
      .expect(422);
    await login(address, 'la phrase du titulaire');
  });

  it('un nouveau lien invalide le précédent', async () => {
    const { email: address } = await verifiedAccount();
    for (let i = 0; i < 2; i += 1) {
      await http()
        .post('/api/v1/auth/password/reset')
        .set(await presession())
        .send({ email: address })
        .expect(202);
    }
    await identity.background.flush();
    const [first] = identity.mail.sent
      .filter((m) => m.to === address && m.subject.startsWith('Réinitialisation'))
      .map((m) => /#([A-Za-z0-9_-]{43})/.exec(m.text)?.[1]);
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set(await presession())
      .send({ token: first, newPassword: 'nouvelle phrase de passe' })
      .expect(422);
  });

  it('limitation par IP : 429 au-delà de 10 demandes', async () => {
    for (let i = 0; i < 10; i += 1) {
      await http()
        .post('/api/v1/auth/password/reset')
        .set(await presession())
        .send({ email: email() })
        .expect(202);
    }
    await http()
      .post('/api/v1/auth/password/reset')
      .set(await presession())
      .send({ email: email() })
      .expect(429);
  });
});

describe('Changement d’e-mail (AUTH-16)', () => {
  function requestChange(user: SignedIn, to: string): request.Test {
    return http().put('/api/v1/auth/email').set(user.mutation).send({ email: to });
  }

  it('exige une ré-authentification récente', async () => {
    const { email: address } = await verifiedAccount();
    const user = await login(address);
    await requestChange(user, email()).expect(401);
  });

  it('adresse libre : lien à la nouvelle, avertissement avec annulation à l’ancienne ; confirmation', async () => {
    const { email: address, accountId } = await verifiedAccount();
    const user = await reauth(await login(address));
    const target = email();
    const res = await requestChange(user, target).expect(202);
    expect(res.text).toBe('');
    await identity.background.flush();

    expect(identity.mail.sent.filter((m) => m.to === address).at(-1)?.text).toMatch(
      /\/auth\/cancel-email-change#[A-Za-z0-9_-]{43}/,
    );
    const token = identity.mail.lastToken(target);
    await http()
      .post('/api/v1/auth/email/verify')
      .set(await presession())
      .send({ token })
      .expect(204);
    expect((await identity.accounts.findById(accountId))?.email).toBe(target);
  });

  it('adresse prise : même réponse, son titulaire est averti, rien ne change', async () => {
    const { email: address, accountId } = await verifiedAccount();
    const { email: taken } = await verifiedAccount();
    const user = await reauth(await login(address));
    const free = await requestChange(user, email()).expect(202);
    const res = await requestChange(user, taken).expect(202);
    expect(res.text).toBe(free.text);
    await identity.background.flush();
    const notice = identity.mail.sent.filter((m) => m.to === taken).at(-1);
    expect(notice?.subject).toBe('Tentative d’utilisation de votre adresse');
    expect(notice?.text).not.toMatch(/#[A-Za-z0-9_-]{43}/);
    expect((await identity.accounts.findById(accountId))?.email).toBe(address);
  });

  it('annulation depuis l’ancienne adresse : adresse rétablie, toutes les sessions révoquées', async () => {
    const { email: address, accountId } = await verifiedAccount();
    const user = await reauth(await login(address));
    const target = email();
    await requestChange(user, target).expect(202);
    await identity.background.flush();
    const cancel = identity.mail.lastToken(address);
    // Le changement est d'abord confirmé (le proche a accès à la nouvelle boîte).
    await http()
      .post('/api/v1/auth/email/verify')
      .set(await presession())
      .send({ token: identity.mail.lastToken(target) })
      .expect(204);

    await http()
      .post('/api/v1/auth/email/cancel')
      .set(await presession())
      .send({ token: cancel })
      .expect(204);
    expect((await identity.accounts.findById(accountId))?.email).toBe(address);
    await http().get('/api/v1/sessions').set('Cookie', user.cookie).expect(401);
    // AUTH-16 : mot de passe effacé (le proche le connaît) ; lien de réinitialisation envoyé à
    // l'adresse rétablie, et à elle seule.
    await http()
      .post('/api/v1/auth/login')
      .set(await presession())
      .send({ email: address, password: PASSWORD })
      .expect(401);
    await identity.background.flush();
    const reset = identity.mail.sent.filter((m) => m.to === address).at(-1);
    expect(reset?.text).toMatch(/\/auth\/reset-password#[A-Za-z0-9_-]{43}/);
    expect(identity.mail.sent.filter((m) => m.to === target).at(-1)?.text).not.toMatch(
      /reset-password#/,
    );
    // À usage unique.
    await http()
      .post('/api/v1/auth/email/cancel')
      .set(await presession())
      .send({ token: cancel })
      .expect(422);
  });

  it('quota d’avertissement de l’ancienne adresse épuisé : aucun lien de confirmation (pas de détournement silencieux)', async () => {
    const { email: address } = await verifiedAccount();
    const user = await reauth(await login(address));
    // Trois demandes : trois avertissements à l'ancienne adresse, le quota de cette sorte est atteint.
    for (let i = 0; i < 3; i += 1) await requestChange(user, email()).expect(202);
    await identity.background.flush();
    const target = email();
    await requestChange(user, target).expect(202);
    await identity.background.flush();
    expect(identity.mail.sent.some((m) => m.to === target)).toBe(false);
  });

  it('I2 : épuiser le quota de réinitialisation ne coupe pas l’avertissement de changement', async () => {
    const { email: address } = await verifiedAccount();
    const user = await reauth(await login(address));
    for (let i = 0; i < 4; i += 1) {
      await http()
        .post('/api/v1/auth/password/reset')
        .set(await presession())
        .send({ email: address })
        .expect(202);
    }
    await identity.background.flush();
    const target = email();
    await requestChange(user, target).expect(202);
    await identity.background.flush();
    expect(identity.mail.lastToken(target)).not.toBeNull();
  });

  it('une nouvelle demande ne désarme pas le lien d’annulation déjà reçu', async () => {
    const { email: address, accountId } = await verifiedAccount();
    const user = await reauth(await login(address));
    await requestChange(user, email()).expect(202);
    await identity.background.flush();
    const firstCancel = identity.mail.lastToken(address);
    await requestChange(user, email()).expect(202);
    await identity.background.flush();
    await http()
      .post('/api/v1/auth/email/cancel')
      .set(await presession())
      .send({ token: firstCancel })
      .expect(204);
    expect((await identity.accounts.findById(accountId))?.email).toBe(address);
  });

  /** Proche qui connaît le mot de passe : change l'adresse vers la sienne et confirme. */
  async function hijack(victim: string): Promise<{ user: SignedIn; attacker: string }> {
    const user = await reauth(await login(victim));
    const attacker = email();
    await requestChange(user, attacker).expect(202);
    await identity.background.flush();
    await http()
      .post('/api/v1/auth/email/verify')
      .set(await presession())
      .send({ token: identity.mail.lastToken(attacker) })
      .expect(204);
    return { user, attacker };
  }

  it('B1 (revue de la tranche 2) : l’annulation de la victime désarme les liens d’annulation émis ensuite', async () => {
    const { email: victim, accountId } = await verifiedAccount();
    const { user, attacker } = await hijack(victim);
    const victimCancel = identity.mail.sent
      .filter((m) => m.to === victim && m.subject === 'Changement d’adresse e-mail demandé')
      .map((m) => /#([A-Za-z0-9_-]{43})/.exec(m.text)?.[1])
      .at(-1);
    // Second changement : un lien d'annulation part vers l'adresse de l'attaquant (adresse courante).
    await requestChange(await reauth(user), email()).expect(202);
    await identity.background.flush();
    const attackerCancel = identity.mail.lastToken(attacker);
    expect(attackerCancel).not.toBeNull();

    await http()
      .post('/api/v1/auth/email/cancel')
      .set(await presession())
      .send({ token: victimCancel })
      .expect(204);
    // Le lien de l'attaquant ne rétablit plus son adresse.
    await http()
      .post('/api/v1/auth/email/cancel')
      .set(await presession())
      .send({ token: attackerCancel })
      .expect(422);
    expect((await identity.accounts.findById(accountId))?.email).toBe(victim);
  });

  it('B2 (revue de la tranche 2) : l’ancienne adresse reste réservée tant que le lien d’annulation est ouvert', async () => {
    const { email: victim, accountId } = await verifiedAccount();
    await hijack(victim);
    // L'attaquant occupe l'adresse libérée par une inscription : rien n'est créé.
    await register(victim, 'mot de passe du tiers').expect(202);
    await identity.background.flush();
    expect([...identity.accounts.rows.values()].filter((r) => r.email === victim)).toHaveLength(0);
    expect(identity.mail.sent.filter((m) => m.to === victim).at(-1)?.subject).toBe(
      'Tentative d’inscription avec votre adresse',
    );

    const cancel = identity.mail.sent
      .filter((m) => m.to === victim && m.subject === 'Changement d’adresse e-mail demandé')
      .map((m) => /#([A-Za-z0-9_-]{43})/.exec(m.text)?.[1])
      .at(-1);
    await http()
      .post('/api/v1/auth/email/cancel')
      .set(await presession())
      .send({ token: cancel })
      .expect(204);
    expect((await identity.accounts.findById(accountId))?.email).toBe(victim);
  });

  it('AUTH-16 : un avis part à l’adresse du compte après un changement de mot de passe', async () => {
    const { email: address } = await verifiedAccount();
    const user = await reauth(await login(address));
    await http()
      .put('/api/v1/auth/password')
      .set(user.mutation)
      .send({ newPassword: 'nouvelle phrase de passe' })
      .expect(200);
    await identity.background.flush();
    expect(identity.mail.sent.filter((m) => m.to === address).at(-1)?.subject).toBe(
      'Votre mot de passe a été changé',
    );
  });
});

describe('Sessions (AUTH-05)', () => {
  it('liste : métadonnées seulement, session courante marquée', async () => {
    const { email: address } = await verifiedAccount();
    await login(address);
    const user = await login(address);
    const res = await http().get('/api/v1/sessions').set('Cookie', user.cookie).expect(200);
    expect(res.body.items).toHaveLength(2);
    for (const item of res.body.items as Record<string, unknown>[]) {
      expect(Object.keys(item).sort()).toEqual(
        ['createdAt', 'current', 'id', 'lastSeenAt', 'userAgent'].sort(),
      );
    }
    expect((res.body.items as { id: string; current: boolean }[]).find((i) => i.current)?.id).toBe(
      user.sessionId,
    );
    expect(res.text).not.toContain(user.tokenHash);
  });

  it('revue SEC-40 (point 1) : la session d’un autre compte répond 404 et reste valide', async () => {
    const { email: mine } = await verifiedAccount();
    const { email: theirs } = await verifiedAccount();
    const user = await login(mine);
    const victim = await login(theirs);
    const res = await http()
      .delete(`/api/v1/sessions/${victim.sessionId}`)
      .set(user.mutation)
      .expect(404);
    expect(res.body).toMatchObject({ code: 'SESSION_NOT_FOUND' });
    await http().get('/api/v1/sessions').set('Cookie', victim.cookie).expect(200);
    expect(identity.sessions.revokedMarks.has(victim.tokenHash)).toBe(false);
  });

  it('révoque une autre session du compte ; révoquer la sienne retire les cookies', async () => {
    const { email: address } = await verifiedAccount();
    const other = await login(address);
    const user = await login(address);
    await http().delete(`/api/v1/sessions/${other.sessionId}`).set(user.mutation).expect(204);
    await http().get('/api/v1/sessions').set('Cookie', other.cookie).expect(401);

    const res = await http()
      .delete(`/api/v1/sessions/${user.sessionId}`)
      .set(user.mutation)
      .expect(204);
    expect(cookiesOf(res).some((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
    await http().get('/api/v1/sessions').set('Cookie', user.cookie).expect(401);
  });

  it('identifiant mal formé : 400', async () => {
    const { email: address } = await verifiedAccount();
    const user = await login(address);
    await http().delete('/api/v1/sessions/pas-un-uuid').set(user.mutation).expect(400);
  });
});

describe('Purge des comptes non vérifiés (AUTH-15)', () => {
  it('compte non vérifié de plus de 7 jours : sessions révoquées, compte et profils supprimés', async () => {
    const address = email();
    await register(address).expect(202);
    await identity.background.flush();
    const created = await identity.accounts.findByEmail(address);
    // Session ouverte sans passer par le mot de passe (refusé tant que non vérifié).
    const user = await openSession(app, { accountId: created?.accountId ?? '' });
    const account = identity.accounts.rows.get(user.accountId);
    if (!account) throw new Error('Compte absent');
    account.createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const { email: kept } = await verifiedAccount();
    const keptRow = [...identity.accounts.rows.values()].find((r) => r.email === kept);
    if (keptRow) keptRow.createdAt = account.createdAt;

    const purged = await app.get(PurgeUnverifiedAccounts).execute();
    expect(purged).toBe(1);
    expect(identity.accounts.rows.has(user.accountId)).toBe(false);
    expect(
      [...identity.accounts.profiles.values()].some((p) => p.accountId === user.accountId),
    ).toBe(false);
    await http().get('/api/v1/sessions').set('Cookie', user.cookie).expect(401);
    expect(await identity.accounts.findByEmail(kept)).not.toBeNull();
  });

  it('compte récent : conservé', async () => {
    const address = email();
    await register(address).expect(202);
    await identity.background.flush();
    await app.get(PurgeUnverifiedAccounts).execute();
    expect(await identity.accounts.findByEmail(address)).not.toBeNull();
  });
});
