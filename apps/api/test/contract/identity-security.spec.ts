import { randomBytes, randomUUID } from 'node:crypto';
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
  UNLOCK_COOKIE,
} from '../../src/modules/identity/presentation/cookies';
import { session, signIn, type SignedIn, WEB_ORIGIN } from '../support/sign-in';
import { createTestApp, type TestIdentity } from './create-test-app';
import {
  PHASE2_IDOR_ROUTES,
  PHASE3_IDOR_ROUTES,
  PHASE4_IDOR_ROUTES,
  PHASE5_IDOR_ROUTES,
} from './idor-routes';
import { listRoutes, type RouteInfo } from './routes';

// Tests de sécurité transverses de la phase 1 (tranche 8) : énumération, CSRF, fixation, force
// brute du second facteur, routes sans session, IDOR, rejeu des jetons à usage unique. Les
// balayages parcourent **toutes** les routes montées : une route ajoutée plus tard y entre seule.
// Règles : critères d'acceptation de `01` et de `09`, SEC-01, SEC-03, API-21, AUTH-02, AUTH-06,
// AUTH-07, AUTH-12, AUTH-15, AUTH-16, PRO-10, PRO-11 ; ADR 0013.

let app: INestApplication;
let identity: TestIdentity;

// Les balayages envoient plusieurs centaines de requêtes.
vi.setConfig({ testTimeout: 30_000 });

beforeAll(async () => {
  // Un mandataire de confiance : `X-Forwarded-For` choisit l'adresse retenue, pour simuler
  // plusieurs adresses IP (SEC-30 ; en production, Caddy écrase l'en-tête du client).
  ({ app, identity } = await createTestApp({ env: { TRUSTED_PROXY_HOPS: '1' } }));
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
  identity.eventThrottle.reset();
  identity.settings.registrationMode = 'OPEN';
});

const http = () => request(app.getHttpServer());
const PASSWORD = 'une phrase de passe assez longue';
const UUID = '0190f3c2-0000-7000-8000-000000000001';
const EVIL_ORIGIN = 'https://evil.example';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

function call(route: RouteInfo, path = route.path.replace(/:[A-Za-z]+/g, UUID)): request.Test {
  return http()[route.method.toLowerCase() as Method](path);
}

const isUnsafe = (route: RouteInfo): boolean => route.method !== 'GET';
const isPublic = (route: RouteInfo): boolean => route.marks.includes('public');

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
  readonly csrf: string;
  readonly headers: Record<string, string>;
}

async function presession(presessionId?: string): Promise<Presession> {
  const res = await http()
    .get('/api/v1/session')
    .set(presessionId ? { Cookie: `${PRESESSION_COOKIE}=${presessionId}` } : {})
    .expect(200);
  const id = cookieValue(res, PRESESSION_COOKIE) ?? '';
  const csrf = res.body.csrfToken as string;
  return {
    id,
    csrf,
    headers: { Cookie: `${PRESESSION_COOKIE}=${id}`, 'X-CSRF-Token': csrf, Origin: WEB_ORIGIN },
  };
}

function email(): string {
  return `s-${randomUUID()}@lahotte.test`;
}

/** Compte vérifié, avec mot de passe, sans profil (base mémoire). */
async function passwordAccount(): Promise<{ email: string; accountId: string }> {
  const address = email();
  const accountId = randomUUID();
  identity.accounts.seed({
    id: accountId,
    email: address,
    passwordHash: await identity.hasher.hash(PASSWORD),
  });
  return { email: address, accountId };
}

function postLogin(headers: Record<string, string>, address: string, password = PASSWORD) {
  return http().post('/api/v1/auth/login').set(headers).send({ email: address, password });
}

function signedFrom(res: request.Response, accountId: string): SignedIn {
  const token = cookieValue(res, SESSION_COOKIE);
  if (!token) throw new Error('Pas de cookie de session');
  const tokenHash = app.get(SecretTokens).hash(token);
  const row = [...identity.sessions.rows.values()].find((r) => r.tokenHash === tokenHash);
  if (!row) throw new Error('Session absente');
  return session(app, token, tokenHash, row.id, accountId, row.activeProfileId);
}

async function login(address: string, accountId: string): Promise<SignedIn> {
  const res = await postLogin((await presession()).headers, address).expect(200);
  expect(res.body.authenticated).toBe(true);
  return signedFrom(res, accountId);
}

/** Même session, ré-authentifiée à l'instant (AUTH-14). */
async function reauthenticated(user: SignedIn): Promise<SignedIn> {
  const rotated = await app.get(SessionLifecycle).rotate({
    id: user.sessionId,
    accountId: user.accountId,
    tokenHash: user.tokenHash,
  });
  return session(
    app,
    rotated.token,
    rotated.record.tokenHash,
    user.sessionId,
    user.accountId,
    rotated.record.activeProfileId,
  );
}

async function totp(secret: string, steps = 0): Promise<string> {
  return generate({ secret, epoch: Math.floor(Date.now() / 1000) + steps * 30 });
}

/** TOTP activé par les routes réelles (AUTH-10). */
async function enableTotp(address: string, accountId: string): Promise<string> {
  const user = await reauthenticated(await login(address, accountId));
  const enrolled = await http().post('/api/v1/auth/totp/enroll').set(user.mutation).expect(200);
  const secret = enrolled.body.secret as string;
  await http()
    .post('/api/v1/auth/totp/activate')
    .set(user.mutation)
    .send({ code: await totp(secret) })
    .expect(200);
  return secret;
}

/** Pré-authentification (mot de passe juste, code attendu), depuis l'adresse `ip`. */
async function loginPending(
  address: string,
  options: { ip?: string; extraCookie?: string } = {},
): Promise<Record<string, string>> {
  const pre = await presession();
  const headers = {
    ...pre.headers,
    Cookie: `${pre.headers.Cookie ?? ''}${options.extraCookie ?? ''}`,
    ...(options.ip ? { 'X-Forwarded-For': options.ip } : {}),
  };
  const res = await postLogin(headers, address).expect(200);
  expect(res.body).toMatchObject({ authenticated: false, secondFactorPending: true });
  return {
    ...headers,
    Cookie: `${headers.Cookie}; ${PENDING_COOKIE}=${cookieValue(res, PENDING_COOKIE) ?? ''}`,
  };
}

function verifyCode(headers: Record<string, string>, code: string, trustDevice?: boolean) {
  return http()
    .post('/api/v1/auth/totp/verify')
    .set(headers)
    .send(trustDevice === undefined ? { code } : { code, trustDevice });
}

/** Compte avec un profil adulte actif, sans PIN, et une adresse (base mémoire). */
async function person(displayName = 'Adulte'): Promise<SignedIn> {
  const user = await identity.signIn({ displayName });
  identity.accounts.seed({ id: user.accountId, email: `t-${user.accountId}@lahotte.test` });
  return user;
}

/** Réponse comparable : statut, corps sans `instance` ni `requestId`, en-têtes, cookies posés. */
const VARYING_HEADERS = new Set(['date', 'etag', 'x-request-id', 'set-cookie', 'retry-after']);
function fingerprint(res: request.Response): unknown {
  const { instance: _i, requestId: _r, ...body } = (res.body ?? {}) as Record<string, unknown>;
  return {
    status: res.status,
    body,
    text: Object.keys(body).length === 0 ? res.text : undefined,
    headers: Object.entries(res.headers)
      .filter(([name]) => !VARYING_HEADERS.has(name))
      .sort(([a], [b]) => a.localeCompare(b)),
    // Noms et attributs des cookies, sans leur valeur.
    cookies: cookiesOf(res)
      .map((c) => c.replace(/^([^=]+)=[^;]*/, '$1=…'))
      .sort(),
    retryAfter: res.headers['retry-after'] !== undefined,
  };
}

/**
 * Travail coûteux fait pendant la requête (argon2), pour comparer les délais (AUTH-02). Le faux
 * hacheur appelle `hash` depuis `verify` : on ne compte que la méthode d'entrée du cas d'usage.
 */
function countHashing(method: 'hash' | 'verify'): { done(): number } {
  const spy = vi.spyOn(identity.hasher, method);
  return {
    done() {
      const total = spy.mock.calls.length;
      spy.mockRestore();
      return total;
    },
  };
}

describe('Énumération (critères de 01, AUTH-02, AUTH-06, AUTH-15)', () => {
  function register(headers: Record<string, string>, address: string, password = PASSWORD) {
    return http()
      .post('/api/v1/auth/register')
      .set(headers)
      .send({ email: address, password, displayName: 'Camille', ageAttested: true });
  }

  /** Inscrite mais jamais vérifiée (AUTH-15), par quelqu'un d'autre. */
  async function unverifiedAddress(): Promise<string> {
    const address = email();
    await register((await presession()).headers, address, 'mot de passe du premier').expect(202);
    await identity.background.flush();
    return address;
  }

  function googleOnlyAddress(): string {
    const address = email();
    identity.accounts.seed({ id: randomUUID(), email: address, passwordHash: null });
    return address;
  }

  it('inscription : adresse libre, vérifiée, non vérifiée ou Google seul — même réponse, même travail', async () => {
    const { email: verified } = await passwordAccount();
    const cases = {
      libre: email(),
      vérifiée: verified,
      'non vérifiée': await unverifiedAddress(),
      'Google seul': googleOnlyAddress(),
    };
    const seen: Record<string, unknown> = {};
    for (const [label, address] of Object.entries(cases)) {
      const pre = await presession();
      const hashing = countHashing('hash');
      const res = await register(pre.headers, address);
      seen[label] = { response: fingerprint(res), hashing: hashing.done() };
    }
    for (const label of Object.keys(cases)) expect(seen[label]).toEqual(seen.libre);
    expect((seen.libre as { response: { status: number } }).response.status).toBe(202);
  });

  it('connexion : compte absent, mot de passe faux, Google seul, non vérifié — même refus, même travail', async () => {
    const { email: verified } = await passwordAccount();
    const cases: Record<string, [string, string]> = {
      absent: [email(), PASSWORD],
      'mot de passe faux': [verified, 'pas le bon mot de passe'],
      'Google seul': [googleOnlyAddress(), PASSWORD],
      // Le sondeur s'inscrit sur l'adresse d'autrui, puis tente son propre mot de passe.
      'non vérifié': [await unverifiedAddress(), 'mot de passe du premier'],
    };
    const seen: Record<string, unknown> = {};
    for (const [label, [address, password]] of Object.entries(cases)) {
      const pre = await presession();
      const hashing = countHashing('verify');
      const res = await postLogin(pre.headers, address, password);
      seen[label] = { response: fingerprint(res), hashing: hashing.done() };
    }
    for (const label of Object.keys(cases)) expect(seen[label]).toEqual(seen.absent);
    expect(seen.absent).toMatchObject({
      response: { status: 401, body: { code: 'INVALID_CREDENTIALS' } },
    });
  });

  it('connexion limitée (AUTH-07) : le 429 est le même, que le compte existe ou non', async () => {
    const { email: verified } = await passwordAccount();
    const seen: unknown[] = [];
    for (const address of [verified, email()]) {
      identity.rateLimiter.reset();
      for (let i = 0; i < 5; i += 1) {
        await postLogin((await presession()).headers, address, 'mauvais').expect(401);
      }
      seen.push(fingerprint(await postLogin((await presession()).headers, address)));
    }
    expect(seen[0]).toMatchObject({ status: 429, retryAfter: true });
    expect(seen[1]).toEqual(seen[0]);
  });

  it('réinitialisation : adresse inscrite, absente, non vérifiée ou Google seul — même réponse', async () => {
    const { email: verified } = await passwordAccount();
    const cases = {
      inscrite: verified,
      absente: email(),
      'non vérifiée': await unverifiedAddress(),
      'Google seul': googleOnlyAddress(),
    };
    const seen: Record<string, unknown> = {};
    for (const [label, address] of Object.entries(cases)) {
      const res = await http()
        .post('/api/v1/auth/password/reset')
        .set((await presession()).headers)
        .send({ email: address });
      seen[label] = fingerprint(res);
    }
    for (const label of Object.keys(cases)) expect(seen[label]).toEqual(seen.inscrite);
    expect(seen.inscrite).toMatchObject({ status: 202 });
  });
});

/** Instantané de l'état durable (hors activité glissante et journal de sécurité). */
function snapshot(): string {
  const {
    sessions,
    accounts,
    links,
    transfers,
    wards,
    trustedDevices,
    secondFactors,
    pendingSecondFactors,
    oidcFlows,
    googleIdentities,
    googleReauthProofs,
    profileRepository,
    mail,
  } = identity;
  return JSON.stringify({
    rows: [...sessions.rows.values()].map(({ lastSeenAt: _l, expiresAt: _e, ...row }) => row),
    marks: [...sessions.revokedMarks],
    // Époque, statut et rôle des comptes (revue SEC-40, M1).
    accountStates: [...sessions.accounts.entries()],
    epochs: [...sessions.cachedEpochs.entries()],
    accounts: [...accounts.rows.values()],
    tokens: [...accounts.tokens.entries()],
    devicesReset: [...accounts.trustedDevicesRevokedAt.entries()],
    profiles: [...accounts.profiles.values()],
    profileEmailTokens: [...profileRepository.emailTokens.entries()],
    links: [...links.links.values()],
    invitations: [...links.invitations.values()],
    blocks: links.blocks,
    transfers: [...transfers.transfers.values()],
    transferMailTokens: [...transfers.mailTokens.entries()],
    setups: [...wards.setups.entries()],
    releaseRequested: [...wards.releaseRequested],
    devices: [...trustedDevices.devices.values()],
    totpSecrets: [...secondFactors.secrets.keys()],
    lastSteps: [...secondFactors.lastSteps.entries()],
    recoveryCodes: [...secondFactors.recoveryCodes.entries()].map(([id, codes]) => [
      id,
      [...codes.entries()],
    ]),
    pending: [...pendingSecondFactors.entries.keys()],
    oidcFlows: [...oidcFlows.entries.keys()],
    googleIdentities: [...googleIdentities.identities.entries()],
    googleProofs: [...googleReauthProofs.entries.keys()],
    // Contenu des e-mails, pas seulement leur nombre.
    mail: mail.sent,
  });
}

describe('CSRF sur toutes les mutations (API-21, ADR 0013)', () => {
  const mutations = (): RouteInfo[] =>
    listRoutes(app).filter((route) => isUnsafe(route) && !route.oidcCallback);

  it('avec une session : jeton absent, d’une autre session ou de pré-session, origine étrangère — 403, rien ne change', async () => {
    const user = await reauthenticated(await identity.signIn());
    const other = await identity.signIn();
    const pre = await presession();
    const attempts: Record<string, Record<string, string>> = {
      'jeton absent': { Cookie: user.cookie, Origin: WEB_ORIGIN },
      'jeton vide': { ...user.mutation, 'X-CSRF-Token': '' },
      'jeton d’une autre session': { ...user.mutation, 'X-CSRF-Token': other.csrf },
      'origine étrangère': { ...user.mutation, Origin: EVIL_ORIGIN },
      'origine absente': { Cookie: user.cookie, 'X-CSRF-Token': user.csrf },
      'Sec-Fetch-Site cross-site': { ...user.mutation, 'Sec-Fetch-Site': 'cross-site' },
      // Un sous-domaine n'est pas l'origine du web.
      'Sec-Fetch-Site same-site': { ...user.mutation, 'Sec-Fetch-Site': 'same-site' },
    };
    const routes = mutations();
    expect(routes.length).toBeGreaterThan(20);
    const before = snapshot();
    for (const route of routes) {
      const cases = isPublic(route)
        ? attempts
        : {
            ...attempts,
            // Hors route publique, seul le jeton de la session vaut, jamais celui de la pré-session.
            'jeton de pré-session': {
              Cookie: `${user.cookie}; ${pre.headers.Cookie ?? ''}`,
              'X-CSRF-Token': pre.csrf,
              Origin: WEB_ORIGIN,
            },
          };
      for (const [label, headers] of Object.entries(cases)) {
        const res = await call(route).set(headers).send({});
        const key = `${route.method} ${route.path} (${label})`;
        expect({ key, status: res.status, code: res.body.code }).toEqual({
          key,
          status: 403,
          code: 'CSRF_REJECTED',
        });
      }
    }
    expect(snapshot()).toBe(before);
  });

  it('CSRF de connexion : sans session, jeton absent, d’une autre pré-session ou origine étrangère — 403 sur toute route publique', async () => {
    const pre = await presession();
    const otherPre = await presession();
    const attempts: Record<string, Record<string, string>> = {
      'jeton absent': { Cookie: pre.headers.Cookie ?? '', Origin: WEB_ORIGIN },
      'jeton d’une autre pré-session': { ...pre.headers, 'X-CSRF-Token': otherPre.csrf },
      'pré-session absente': { 'X-CSRF-Token': pre.csrf, Origin: WEB_ORIGIN },
      'origine étrangère': { ...pre.headers, Origin: EVIL_ORIGIN },
      'Sec-Fetch-Site cross-site': { ...pre.headers, 'Sec-Fetch-Site': 'cross-site' },
    };
    const routes = mutations().filter(isPublic);
    expect(routes.map((route) => route.path)).toContain('/api/v1/auth/login');
    const before = snapshot();
    for (const route of routes) {
      for (const [label, headers] of Object.entries(attempts)) {
        const res = await call(route).set(headers).send({});
        const key = `${route.method} ${route.path} (${label})`;
        expect({ key, status: res.status, code: res.body.code }).toEqual({
          key,
          status: 403,
          code: 'CSRF_REJECTED',
        });
      }
    }
    expect(snapshot()).toBe(before);
  });

  it('CSRF de connexion : un formulaire d’un autre site avec les identifiants de l’attaquant n’ouvre aucune session', async () => {
    const { email: address } = await passwordAccount();
    const pre = await presession();
    const sessionsBefore = identity.sessions.rows.size;
    const res = await postLogin({ ...pre.headers, Origin: EVIL_ORIGIN }, address).expect(403);
    expect(cookieValue(res, SESSION_COOKIE)).toBeNull();
    expect(identity.sessions.rows.size).toBe(sessionsBefore);
  });

  it('journal : une ligne csrf.rejected par fenêtre et par (adresse, compte), une adresse IPv6 comptant pour son /64 (revue SEC-40, M4)', async () => {
    const user = await identity.signIn();
    const lines = (): number =>
      identity.securityLog.entries.filter(
        (e) => e.event === 'csrf.rejected' && e.accountId === user.accountId,
      ).length;
    const reject = (ip: string) =>
      http()
        .post('/api/v1/session/lock')
        .set({ Cookie: user.cookie, Origin: WEB_ORIGIN, 'X-Forwarded-For': ip })
        .expect(403);
    await reject('2001:db8:1:1::1');
    await reject('2001:db8:1:1::1');
    // Même /64 : la même adresse pour la limitation.
    await reject('2001:db8:1:1:ffff::2');
    expect(lines()).toBe(1);
    // Autre /64, puis IPv4 : une ligne de plus chacune.
    await reject('2001:db8:1:2::1');
    await reject('198.51.100.20');
    expect(lines()).toBe(3);
  });

  it('rotation par ré-authentification : l’ancien jeton CSRF est refusé sur une route réelle', async () => {
    const { email: address, accountId } = await passwordAccount();
    const user = await login(address, accountId);
    const res = await http()
      .post('/api/v1/auth/reauth')
      .set(user.mutation)
      .send({ password: PASSWORD })
      .expect(200);
    const fresh = signedFrom(res, accountId);
    expect(fresh.csrf).not.toBe(user.csrf);
    await http()
      .post('/api/v1/session/lock')
      .set({ ...fresh.mutation, 'X-CSRF-Token': user.csrf })
      .expect(403);
    await http().post('/api/v1/session/lock').set(fresh.mutation).expect(204);
  });
});

describe('CORS sur toutes les routes (SEC-14 ; revue SEC-40 de la tranche 8, I2)', () => {
  // Les lectures n'ont que CORS comme barrière face à un sous-domaine du même site, qui reçoit
  // les cookies `SameSite=Lax` : `GET /session` y rendrait le jeton CSRF.
  const FOREIGN = [EVIL_ORIGIN, 'http://evil.localhost:3000', 'http://localhost:3001', 'null'];
  const corsHeaders = (res: request.Response) => ({
    allowOrigin: res.headers['access-control-allow-origin'] as unknown,
    allowCredentials: res.headers['access-control-allow-credentials'] as unknown,
  });

  it('contrôle : l’origine du web reçoit ses en-têtes CORS, lecture et requête préliminaire', async () => {
    const read = await http().get('/api/v1/session').set('Origin', WEB_ORIGIN).expect(200);
    expect(corsHeaders(read)).toEqual({ allowOrigin: WEB_ORIGIN, allowCredentials: 'true' });
    const preflight = await http().options('/api/v1/session/lock').set({
      Origin: WEB_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'x-csrf-token,content-type',
    });
    expect(corsHeaders(preflight)).toEqual({ allowOrigin: WEB_ORIGIN, allowCredentials: 'true' });
  });

  it('origine étrangère, sous-domaine, autre port ou `null` : aucun en-tête CORS sur aucune lecture', async () => {
    const user = await identity.signIn();
    const reads = listRoutes(app).filter((route) => route.method === 'GET' && !route.oidcCallback);
    expect(reads.length).toBeGreaterThan(10);
    for (const route of reads) {
      for (const origin of FOREIGN) {
        const res = await call(route).set({ Cookie: user.cookie, Origin: origin });
        const key = `${route.method} ${route.path} (${origin})`;
        expect({ key, ...corsHeaders(res) }).toEqual({
          key,
          allowOrigin: undefined,
          allowCredentials: undefined,
        });
      }
    }
  });

  it('requête préliminaire d’une origine étrangère : aucun en-tête CORS, sur aucun chemin', async () => {
    const paths = [
      ...new Set(listRoutes(app).map((route) => route.path.replace(/:[A-Za-z]+/g, UUID))),
    ];
    for (const path of paths) {
      for (const origin of FOREIGN) {
        const res = await http().options(path).set({
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'x-csrf-token,content-type',
        });
        const key = `OPTIONS ${path} (${origin})`;
        expect({ key, ...corsHeaders(res) }).toEqual({
          key,
          allowOrigin: undefined,
          allowCredentials: undefined,
        });
      }
    }
  });
});

describe('Fixation de session (ADR 0013)', () => {
  it('un jeton de session planté avant la connexion n’est jamais adopté', async () => {
    const { email: address, accountId } = await passwordAccount();
    const planted = app.get(SecretTokens).generate();
    const pre = await presession();
    const res = await postLogin(
      { ...pre.headers, Cookie: `${pre.headers.Cookie ?? ''}; ${SESSION_COOKIE}=${planted}` },
      address,
    ).expect(200);
    const issued = cookieValue(res, SESSION_COOKIE);
    expect(issued).toEqual(expect.any(String));
    expect(issued).not.toBe(planted);
    expect(signedFrom(res, accountId).accountId).toBe(accountId);
    const status = await http()
      .get('/api/v1/session')
      .set('Cookie', `${SESSION_COOKIE}=${planted}`)
      .expect(200);
    expect(status.body.authenticated).toBe(false);
  });

  it('la session de l’attaquant plantée chez la victime ne donne jamais accès au compte de la victime', async () => {
    const attacker = await passwordAccount();
    const victim = await passwordAccount();
    const planted = await login(attacker.email, attacker.accountId);
    const pre = await presession();
    const res = await postLogin(
      { ...pre.headers, Cookie: `${pre.headers.Cookie ?? ''}; ${planted.cookie}` },
      victim.email,
    ).expect(200);
    const issued = signedFrom(res, victim.accountId);
    expect(issued.token).not.toBe(planted.token);
    expect(issued.sessionId).not.toBe(planted.sessionId);
    // La connexion révoque la session présentée (rotation, ADR 0013) : le jeton planté ne vaut
    // plus rien, ni pour la victime ni pour l'attaquant (revue SEC-40, M9).
    const row = [...identity.sessions.rows.values()].find((r) => r.tokenHash === planted.tokenHash);
    expect(row).toBeUndefined();
    await http().get('/api/v1/account').set('Cookie', planted.cookie).expect(401);
    const victimSessions = [...identity.sessions.rows.values()].filter(
      (r) => r.accountId === victim.accountId,
    );
    expect(victimSessions.map((r) => r.tokenHash)).not.toContain(planted.tokenHash);
  });

  it('une pré-session choisie par l’attaquant ne devient ni la session ni sa clé CSRF', async () => {
    const { email: address, accountId } = await passwordAccount();
    const chosen = app.get(SecretTokens).generate();
    // Le serveur reprend une pré-session bien formée (elle n'est liée à rien) : l'attaquant
    // connaîtrait son jeton CSRF.
    const pre = await presession(chosen);
    expect(pre.id).toBe(chosen);
    const res = await postLogin(pre.headers, address).expect(200);
    expect(cookiesOf(res).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))).toMatch(
      /Expires=Thu, 01 Jan 1970/,
    );
    const user = signedFrom(res, accountId);
    expect(user.token).not.toBe(chosen);
    expect(user.csrf).not.toBe(pre.csrf);
    await http()
      .post('/api/v1/session/lock')
      .set({
        Cookie: `${user.cookie}; ${pre.headers.Cookie ?? ''}`,
        'X-CSRF-Token': pre.csrf,
        Origin: WEB_ORIGIN,
      })
      .expect(403);
  });

  it('second facteur : une pré-authentification plantée ne vaut rien ; la session rendue est neuve', async () => {
    const { email: address, accountId } = await passwordAccount();
    const secret = await enableTotp(address, accountId);
    const pre = await presession();
    const planted = app.get(SecretTokens).generate();
    const forged = await verifyCode(
      { ...pre.headers, Cookie: `${pre.headers.Cookie ?? ''}; ${PENDING_COOKIE}=${planted}` },
      await totp(secret, 1),
    ).expect(401);
    expect(forged.body.code).toBe('SECOND_FACTOR_EXPIRED');

    const pending = await loginPending(address);
    const pendingToken = /__Host-lh_pending=([^;]+)/.exec(pending.Cookie ?? '')?.[1];
    const verified = await verifyCode(pending, await totp(secret, 1)).expect(200);
    const token = cookieValue(verified, SESSION_COOKIE);
    expect(token).toEqual(expect.any(String));
    expect(token).not.toBe(pendingToken);
  });

  it('revue SEC-40 (I3), ADR 0015 : la pré-session d’autrui ne lie pas un parcours Google — pas de connexion forcée par le retour', async () => {
    identity.google.enabled = true;
    // La victime navigue sans session ; un proche a lu sa pré-session `P` sur l'appareil.
    const victim = await presession();
    // Depuis sa machine, il démarre un parcours Google avec `P` et le jeton CSRF qu'elle donne.
    const started = await http()
      .post('/api/v1/auth/google/start')
      .set(victim.headers)
      .send({ registration: { displayName: 'Proche', ageAttested: true } })
      .expect(200);
    const fresh = cookieValue(started, PRESESSION_COOKIE);
    expect(fresh).toEqual(expect.any(String));
    expect(fresh).not.toBe(victim.id);
    const query = identity.google.approve(started.body.authorizationUrl as string, {
      subject: `proche-${randomUUID()}`,
    });
    // Il envoie le lien de retour à la victime, dont le navigateur porte toujours `P`.
    const sessionsBefore = identity.sessions.rows.size;
    const res = await http()
      .get(`/api/v1/auth/google/callback?${query}`)
      .set('Cookie', victim.headers.Cookie ?? '')
      .expect(303);
    expect(new URL(res.headers.location as string).searchParams.get('error')).toBe(
      'GOOGLE_FLOW_INVALID',
    );
    expect(cookieValue(res, SESSION_COOKIE)).toBeNull();
    expect(identity.sessions.rows.size).toBe(sessionsBefore);
  });

  it('PIN-07 : un cookie de déverrouillage planté ne déverrouille pas le profil', async () => {
    const user = await identity.signIn({ pin: true, relock: 'EVERY_OPEN' });
    const planted = app.get(SecretTokens).generate();
    const res = await http()
      .get('/api/v1/profiles/me')
      .set('Cookie', `${user.cookie}; ${UNLOCK_COOKIE}=${planted}`)
      .expect(423);
    expect(res.body.code).toBe('PROFILE_LOCKED');
  });
});

describe('Force brute du second facteur (AUTH-07, AUTH-12, ADR 0013)', () => {
  it('pré-authentifications successives depuis dix adresses : cinq codes évalués, pas un de plus', async () => {
    const { email: address, accountId } = await passwordAccount();
    const secret = await enableTotp(address, accountId);
    const failedBefore = identity.securityLog.entries.filter(
      (e) => e.event === 'totp.failed' && e.accountId === accountId,
    ).length;
    const statuses: number[] = [];
    for (let i = 1; i <= 10; i += 1) {
      const ip = `203.0.113.${i}`;
      // Le mot de passe est juste à chaque fois : le compteur du couple est remis à zéro, celui
      // du second facteur, par compte seul, ne l'est pas.
      const pending = await loginPending(address, { ip });
      statuses.push((await verifyCode(pending, '000000')).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429, 429, 429, 429]);
    const failed = identity.securityLog.entries.filter(
      (e) => e.event === 'totp.failed' && e.accountId === accountId,
    ).length;
    expect(failed - failedBefore).toBe(5);
    // Le bon code, depuis une onzième adresse, n'est pas évalué.
    const last = await loginPending(address, { ip: '198.51.100.7' });
    await verifyCode(last, await totp(secret, 1)).expect(429);
  });

  it('reste de la tranche 3 : le seuil de 50 n’est pas accordé avec l’appareil de confiance d’un autre compte', async () => {
    const victim = await passwordAccount();
    const victimSecret = await enableTotp(victim.email, victim.accountId);
    const own = await verifyCode(
      await loginPending(victim.email),
      await totp(victimSecret, 1),
      true,
    ).expect(200);
    const ownDevice = `; ${DEVICE_COOKIE}=${cookieValue(own, DEVICE_COOKIE) ?? ''}`;

    const attacker = await passwordAccount();
    const attackerSecret = await enableTotp(attacker.email, attacker.accountId);
    const foreign = await verifyCode(
      await loginPending(attacker.email),
      await totp(attackerSecret, 1),
      true,
    ).expect(200);
    const foreignDevice = `; ${DEVICE_COOKIE}=${cookieValue(foreign, DEVICE_COOKIE) ?? ''}`;

    // 30 échecs comptés sur l'adresse de la victime (portée `login_account`, seuil 20 ; le délai
    // atteint alors son plafond, sans dépendre de la durée du test).
    const now = new Date();
    for (let i = 0; i < 30; i += 1) {
      await identity.rateLimiter.recordFailure(
        [{ scope: 'login_account', parts: [victim.email] }],
        now,
        `seed-${i}`,
      );
    }
    const attempt = async (device: string, ip: string): Promise<request.Response> => {
      const pre = await presession();
      return postLogin(
        { ...pre.headers, Cookie: `${pre.headers.Cookie ?? ''}${device}`, 'X-Forwarded-For': ip },
        victim.email,
      );
    };
    expect((await attempt('', '192.0.2.10')).status).toBe(429);
    expect((await attempt(foreignDevice, '192.0.2.11')).status).toBe(429);
    // Avec son propre appareil, le titulaire n'est pas exclu de son compte (ADR 0013).
    const allowed = await attempt(ownDevice, '192.0.2.12');
    expect({ status: allowed.status, authenticated: allowed.body.authenticated }).toEqual({
      status: 200,
      authenticated: true,
    });
  });
});

describe('Routes sans session valide (critère de 09, SEC-01, ADR 0013)', () => {
  const guarded = (): RouteInfo[] => listRoutes(app).filter((route) => !isPublic(route));

  async function expectEverywhere(
    headers: Record<string, string>,
    expected: { status: number; code: string },
    routes = guarded(),
  ): Promise<void> {
    expect(routes.length).toBeGreaterThan(20);
    for (const route of routes) {
      const res = await call(route).set(headers).send({});
      const key = `${route.method} ${route.path}`;
      expect({ key, status: res.status, code: res.body.code }).toEqual({ key, ...expected });
    }
  }

  it('pré-authentification seule (mot de passe juste, code attendu) : 401 partout hors liste publique', async () => {
    const { email: address, accountId } = await passwordAccount();
    await enableTotp(address, accountId);
    await expectEverywhere(await loginPending(address), { status: 401, code: 'UNAUTHENTICATED' });
  });

  it('session révoquée : 401 partout hors liste publique', async () => {
    const user = await identity.signIn();
    await app
      .get(SessionLifecycle)
      .revoke({ id: user.sessionId, accountId: user.accountId, tokenHash: user.tokenHash });
    await expectEverywhere(user.mutation, { status: 401, code: 'UNAUTHENTICATED' });
  });

  it('époque du compte augmentée (mot de passe changé, réinitialisé) : 401 partout', async () => {
    const user = await identity.signIn();
    await identity.sessions.beginEpochChange(user.accountId);
    await expectEverywhere(user.mutation, { status: 401, code: 'UNAUTHENTICATED' });
  });

  it('jeton de session forgé : 401 partout', async () => {
    const forged = `${SESSION_COOKIE}=${app.get(SecretTokens).generate()}`;
    await expectEverywhere(
      { Cookie: forged, Origin: WEB_ORIGIN },
      { status: 401, code: 'UNAUTHENTICATED' },
    );
  });

  it('critère de 01 : profil protégé non déverrouillé, ou aucun profil actif — 423 sur toute route de profil', async () => {
    const profileRoutes = listRoutes(app).filter((route) => route.marks.includes('profile'));
    expect(profileRoutes.length).toBeGreaterThan(10);
    const locked = await identity.signIn({ pin: true });
    await expectEverywhere(locked.mutation, { status: 423, code: 'PROFILE_LOCKED' }, profileRoutes);
    const none = await identity.signIn({ withProfile: false });
    await expectEverywhere(none.mutation, { status: 423, code: 'PROFILE_LOCKED' }, profileRoutes);
  });
});

describe('IDOR : ressources d’un autre compte (SEC-03, critère de 01)', () => {
  async function link(x: SignedIn, y: SignedIn): Promise<void> {
    const invitation = await http()
      .post('/api/v1/invitations')
      .set(x.mutation)
      .send({})
      .expect(201);
    await http()
      .post('/api/v1/invitations/redeem')
      .set(y.mutation)
      .send({ token: invitation.body.token })
      .expect(201);
  }

  async function addProfile(owner: SignedIn, displayName: string): Promise<SignedIn> {
    const profileId = randomUUID();
    identity.profiles.set({
      profileId,
      accountId: owner.accountId,
      hasPin: false,
      relock: 'IDLE_15',
    });
    const created = identity.accounts.profiles.get(profileId);
    if (created) identity.accounts.profiles.set(profileId, { ...created, displayName });
    return signIn(app, { accountId: owner.accountId, profileId });
  }

  /**
   * Monde de la victime : compte B (trois profils, une session, un appareil de confiance, un lien
   * avec C, une invitation ouverte, un blocage, une proposition de profil reçue, un compte sous
   * tutelle, un passage demandé vers C et accepté par C), et deux proches : E, lié à B, et un
   * autre profil adulte du compte de B.
   */
  async function victimWorld() {
    const b = await person('Bea');
    const b2 = await addProfile(b, 'Basile');
    // Session de l'espace Compte de B, renouvelée à chaque ré-authentification (rotation).
    let owner = b;
    const c = await person('Cyril');
    const d = await person('Dora');
    await link(b, c);
    await link(b2, c);
    const linkId = identity.links.linksOf(b.profileId ?? '')[0]?.id ?? '';
    // On ne bloque qu'un profil connu (LNK-05) : B se lie à D avant de le bloquer.
    await link(b, d);

    const invitationsBefore = new Set(identity.links.invitations.keys());
    await http().post('/api/v1/invitations').set(b.mutation).send({}).expect(201);
    const invitationId =
      [...identity.links.invitations.keys()].find((k) => !invitationsBefore.has(k)) ?? '';

    await http()
      .post('/api/v1/blocks')
      .set(b.mutation)
      .send({ profileId: d.profileId })
      .expect(204);

    await http()
      .post('/api/v1/invitations')
      .set(c.mutation)
      .send({ kind: 'PROFILE', targetProfileId: b.profileId })
      .expect(201);
    const proposals = await http()
      .get('/api/v1/account/profile-proposals')
      .set({ Cookie: b.cookie })
      .expect(200);
    const proposalId = proposals.body.items[0]?.id as string;

    const deviceId = randomUUID();
    await identity.trustedDevices.create({
      id: deviceId,
      accountId: b.accountId,
      tokenHash: `hash-${deviceId}`,
      userAgent: 'navigateur de la victime',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
    });

    const wardEmail = `ward-${randomUUID()}@lahotte.test`;
    await http()
      .post('/api/v1/account/wards')
      .set((owner = await reauthenticated(owner)).mutation)
      .send({ email: wardEmail, profileName: 'Léa', guardianAttested: true })
      .expect(204);
    await identity.background.flush();
    await http()
      .post('/api/v1/accounts/setup')
      .set((await presession()).headers)
      .send({ token: identity.mail.lastToken(wardEmail), password: PASSWORD })
      .expect(204);
    const wardId = (await identity.accounts.findByEmail(wardEmail))?.accountId ?? '';

    const moved = await http()
      .post(`/api/v1/account/profiles/${b2.profileId ?? ''}/transfer`)
      .set((owner = await reauthenticated(owner)).mutation)
      .send({ kind: 'MOVE' })
      .expect(201);
    await http()
      .post('/api/v1/profiles/me/transfer/consent')
      .set(b2.mutation)
      .send({ pinChoice: 'NONE' })
      .expect(204);
    const host = await reauthenticated(c);
    await http()
      .post('/api/v1/account/transfers/accept')
      .set(host.mutation)
      .send({ token: moved.body.token })
      .expect(204);
    const incoming = await http()
      .get('/api/v1/account/transfers')
      .set({ Cookie: host.cookie })
      .expect(200);
    const transferId = incoming.body.items[0]?.id as string;

    // Un proche du cercle de B (partie à aucune ressource ci-dessus) et un troisième profil
    // adulte du compte de B.
    const circleMember = await person('Eve');
    await link(owner, circleMember);
    const sibling = await addProfile(b, 'Bérénice');

    return {
      victimSession: owner,
      circleMember,
      sibling,
      ids: {
        sessionId: b.sessionId,
        deviceId,
        linkId,
        invitationId,
        blockedProfileId: d.profileId ?? '',
        proposalId,
        profileId: b.profileId ?? '',
        movingProfileId: b2.profileId ?? '',
        transferId,
        wardId,
      },
    };
  }

  it('chaque route à identifiant : 404 pour la ressource d’autrui, comme pour un identifiant inconnu ; rien ne change', async () => {
    const { ids, victimSession, circleMember, sibling } = await victimWorld();
    type Ids = typeof ids;
    // Une ligne par route à paramètre ; le test suivant exige qu'aucune ne manque.
    const table: Array<{
      route: string;
      id: keyof Ids;
      body?: Record<string, unknown>;
      /** Statut commun attendu ; 404 sauf mention. */
      status?: number;
    }> = [
      { route: 'DELETE /api/v1/sessions/:id', id: 'sessionId' },
      { route: 'DELETE /api/v1/trusted-devices/:id', id: 'deviceId' },
      { route: 'POST /api/v1/links/:id/approve', id: 'linkId' },
      { route: 'DELETE /api/v1/links/:id', id: 'linkId' },
      { route: 'DELETE /api/v1/invitations/:id', id: 'invitationId' },
      // Le blocage est celui du profil actif : lever « le sien » ne touche pas celui de B.
      { route: 'DELETE /api/v1/blocks/:profileId', id: 'blockedProfileId' },
      { route: 'POST /api/v1/account/profile-proposals/:id/accept', id: 'proposalId' },
      { route: 'DELETE /api/v1/account/profile-proposals/:id', id: 'proposalId' },
      { route: 'DELETE /api/v1/account/profiles/:id', id: 'profileId' },
      { route: 'PUT /api/v1/account/profiles/:id/child', id: 'profileId', body: { isChild: true } },
      {
        route: 'PUT /api/v1/account/profiles/:id/pin/reset',
        id: 'profileId',
        body: { newPin: '2468' },
      },
      { route: 'DELETE /api/v1/account/profiles/:id/pin', id: 'profileId' },
      {
        route: 'POST /api/v1/account/profiles/:id/transfer',
        id: 'profileId',
        body: { kind: 'MOVE' },
      },
      { route: 'GET /api/v1/account/profiles/:id/transfer', id: 'movingProfileId' },
      { route: 'DELETE /api/v1/account/profiles/:id/transfer', id: 'movingProfileId' },
      { route: 'DELETE /api/v1/account/transfers/:id/acceptance', id: 'transferId' },
      { route: 'GET /api/v1/account/wards/:id', id: 'wardId' },
      { route: 'DELETE /api/v1/account/wards/:id/sessions', id: 'wardId' },
      { route: 'POST /api/v1/account/wards/:id/password-reset', id: 'wardId' },
      {
        route: 'POST /api/v1/account/wards/:id/profiles',
        id: 'wardId',
        body: { displayName: 'Intrus' },
      },
      { route: 'POST /api/v1/account/wards/:id/release', id: 'wardId' },
    ];

    // Revue SEC-40 (I4) : trois attaquants du modèle de menaces. Un inconnu ; un proche du cercle
    // de B, partie à aucune de ces ressources ; un autre profil adulte du compte de B, sur les
    // routes de profil seulement (sur l'espace Compte, le même compte est légitime).
    const profileRoutes = new Set(
      listRoutes(app)
        .filter((route) => route.marks.includes('profile'))
        .map((route) => `${route.method} ${route.path}`),
    );
    const attackers: Array<{ label: string; session: SignedIn; profileOnly: boolean }> = [
      { label: 'inconnu', session: await person('Attaquant'), profileOnly: false },
      { label: 'proche du cercle', session: circleMember, profileOnly: false },
      { label: 'autre profil du compte', session: sibling, profileOnly: true },
    ];
    const attackerSessions = new Set(attackers.map((a) => a.session.sessionId));
    const before = snapshot();
    let checked = 0;
    for (const attacker of attackers) {
      let current = attacker.session;
      for (const row of table) {
        if (attacker.profileOnly && !profileRoutes.has(row.route)) continue;
        const [method, template] = row.route.split(' ') as [string, string];
        const send = async (id: string): Promise<request.Response> => {
          // Ré-authentification à l'instant : la garde AUTH-14 ne masque pas la décision.
          const fresh = (current = await reauthenticated(current));
          const path = template.replace(/:[A-Za-z]+/, id);
          const req = http()[method.toLowerCase() as Method](path);
          return method === 'GET'
            ? req.set({ Cookie: fresh.cookie })
            : req.set(fresh.mutation).send(row.body ?? {});
        };
        const victim = await send(ids[row.id]);
        const unknown = await send(randomUUID());
        const key = `${row.route} (${attacker.label})`;
        const expected = { status: row.status ?? 404, code: unknown.body.code as unknown };
        expect({ key, status: victim.status, code: victim.body.code }).toEqual({
          key,
          ...expected,
        });
        expect({ key, status: unknown.status }).toEqual({ key, status: expected.status });
        checked += 1;
      }
    }
    // 21 routes pour deux attaquants, 4 routes de profil pour le troisième.
    expect(checked).toBe(table.length * 2 + 4);
    // Les seuls changements sont ceux des attaquants (sessions ré-authentifiées).
    const strip = (json: string): unknown => {
      // Marques de révocation : celles des jetons remplacés par les rotations des attaquants.
      const { marks: _m, ...parsed } = JSON.parse(json) as {
        rows: { id: string }[];
        marks: unknown;
      };
      return { ...parsed, rows: parsed.rows.filter((r) => !attackerSessions.has(r.id)) };
    };
    expect(strip(snapshot())).toEqual(strip(before));
    // Et la session de la victime vit toujours.
    await http().get('/api/v1/account').set({ Cookie: victimSession.cookie }).expect(200);
  });

  it('aucune route à identifiant n’échappe à la table IDOR', () => {
    const withParam = listRoutes(app)
      .filter((route) => route.path.includes('/:'))
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    // Même liste que la table du test précédent : une route nouvelle doit y être ajoutée.
    expect(withParam).toEqual(
      [
        'DELETE /api/v1/sessions/:id',
        'DELETE /api/v1/trusted-devices/:id',
        'POST /api/v1/links/:id/approve',
        'DELETE /api/v1/links/:id',
        'DELETE /api/v1/invitations/:id',
        'DELETE /api/v1/blocks/:profileId',
        'POST /api/v1/account/profile-proposals/:id/accept',
        'DELETE /api/v1/account/profile-proposals/:id',
        'DELETE /api/v1/account/profiles/:id',
        'PUT /api/v1/account/profiles/:id/child',
        'PUT /api/v1/account/profiles/:id/pin/reset',
        'DELETE /api/v1/account/profiles/:id/pin',
        'POST /api/v1/account/profiles/:id/transfer',
        'GET /api/v1/account/profiles/:id/transfer',
        'DELETE /api/v1/account/profiles/:id/transfer',
        'DELETE /api/v1/account/transfers/:id/acceptance',
        'GET /api/v1/account/wards/:id',
        'DELETE /api/v1/account/wards/:id/sessions',
        'POST /api/v1/account/wards/:id/password-reset',
        'POST /api/v1/account/wards/:id/profiles',
        'POST /api/v1/account/wards/:id/release',
        // Phase 2 : table de `lists-security.spec.ts`.
        ...PHASE2_IDOR_ROUTES,
        // Phase 3 : table de `events-security.spec.ts`.
        ...PHASE3_IDOR_ROUTES,
        // Phase 4 : table de `exchanges-security.spec.ts`.
        ...PHASE4_IDOR_ROUTES,
        // Phase 5 : table de `accounting-contributions.spec.ts`.
        ...PHASE5_IDOR_ROUTES,
      ].sort(),
    );
  });
});

describe('Rejeu des jetons à usage unique (critères de 01)', () => {
  // Déjà couverts ailleurs, avec la même exigence (même refus qu'un jeton inconnu) : invitation
  // de lien (`identity-links.spec.ts`, LNK-07), installation d'un compte (`identity-wards.spec.ts`,
  // PRO-15), jetons d'accord, d'annulation et de passage (`identity-transfers.spec.ts`, PRO-12),
  // retour Google (`identity-google.spec.ts`, AUTH-03), code TOTP et code de secours
  // (`identity-second-factor.spec.ts`, AUTH-10, AUTH-11), pré-authentification consommée.

  /** Jeton inconnu de même forme (longueur, alphabet base64url) que le jeton rejoué. */
  const unknownLike = (token: string): string =>
    randomBytes(token.length).toString('base64url').slice(0, token.length);
  const refusal = (res: request.Response) => ({
    status: res.status,
    code: res.body.code as unknown,
  });

  async function replayAndUnknown(
    path: string,
    body: (token: string) => Record<string, unknown>,
    token: string,
    headers: () => Promise<Record<string, string>>,
  ): Promise<void> {
    const replayed = await http()
      .post(path)
      .set(await headers())
      .send(body(token));
    const unknown = await http()
      .post(path)
      .set(await headers())
      .send(body(unknownLike(token)));
    expect(replayed.status).toBeGreaterThanOrEqual(400);
    expect({ path, ...refusal(replayed) }).toEqual({ path, ...refusal(unknown) });
  }

  const anonymous = async (): Promise<Record<string, string>> => (await presession()).headers;

  it('lien de vérification d’e-mail (AUTH-15)', async () => {
    const address = email();
    await http()
      .post('/api/v1/auth/register')
      .set(await anonymous())
      .send({ email: address, password: PASSWORD, displayName: 'Camille', ageAttested: true })
      .expect(202);
    await identity.background.flush();
    const token = identity.mail.lastToken(address) ?? '';
    await http()
      .post('/api/v1/auth/email/verify')
      .set(await anonymous())
      .send({ token })
      .expect(204);
    await replayAndUnknown('/api/v1/auth/email/verify', (t) => ({ token: t }), token, anonymous);
  });

  it('lien de réinitialisation du mot de passe (AUTH-06)', async () => {
    const { email: address } = await passwordAccount();
    await http()
      .post('/api/v1/auth/password/reset')
      .set(await anonymous())
      .send({ email: address })
      .expect(202);
    await identity.background.flush();
    const token = identity.mail.lastToken(address) ?? '';
    const body = (t: string) => ({ token: t, newPassword: 'une toute nouvelle phrase' });
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set(await anonymous())
      .send(body(token))
      .expect(204);
    await replayAndUnknown('/api/v1/auth/password/reset/confirm', body, token, anonymous);
  });

  it('liens de confirmation et d’annulation d’un changement d’e-mail (AUTH-16)', async () => {
    const { email: address, accountId } = await passwordAccount();
    const user = await reauthenticated(await login(address, accountId));
    const target = email();
    await http().put('/api/v1/auth/email').set(user.mutation).send({ email: target }).expect(202);
    await identity.background.flush();
    const confirm = identity.mail.lastToken(target) ?? '';
    const cancel = identity.mail.lastToken(address) ?? '';
    await http()
      .post('/api/v1/auth/email/verify')
      .set(await anonymous())
      .send({ token: confirm })
      .expect(204);
    await replayAndUnknown('/api/v1/auth/email/verify', (t) => ({ token: t }), confirm, anonymous);
    await http()
      .post('/api/v1/auth/email/cancel')
      .set(await anonymous())
      .send({ token: cancel })
      .expect(204);
    await replayAndUnknown('/api/v1/auth/email/cancel', (t) => ({ token: t }), cancel, anonymous);
  });

  it('lien de vérification de l’adresse d’un profil (PRO-10)', async () => {
    const user = await person();
    const address = `moi-${user.accountId}@lahotte.test`;
    await http()
      .put('/api/v1/profiles/me/email')
      .set(user.mutation)
      .send({ email: address })
      .expect(204);
    await identity.background.flush();
    const token = identity.mail.lastToken(address) ?? '';
    await http()
      .post('/api/v1/profiles/email/verify')
      .set(await anonymous())
      .send({ token })
      .expect(204);
    await replayAndUnknown(
      '/api/v1/profiles/email/verify',
      (t) => ({ token: t }),
      token,
      anonymous,
    );
  });

  it('invitation à créer un profil (PRO-11)', async () => {
    const inviter = await person('Alice');
    const created = await http()
      .post('/api/v1/invitations')
      .set(inviter.mutation)
      .send({ kind: 'PROFILE' })
      .expect(201);
    const token = created.body.token as string;
    const body = (t: string) => ({ token: t, displayName: 'Cousin' });
    await http()
      .post('/api/v1/invitations/profile/accept')
      .set(await anonymous())
      .send(body(token))
      .expect(204);
    await replayAndUnknown('/api/v1/invitations/profile/accept', body, token, anonymous);
  });
});
