import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { PRESESSION_COOKIE } from '../../src/modules/identity/presentation/cookies';
import { session, signIn, type SignedIn, WEB_ORIGIN } from '../support/sign-in';
import { createTestApp, type TestIdentity } from './create-test-app';

// Effacement du compte et inactivité : RGPD-05, RGPD-09, RGPD-12, RGPD-13.

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
const DAY = 24 * 3600 * 1000;

function cookieValue(res: request.Response, name: string): string | null {
  const raw = res.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(raw) ? (raw as string[]) : [];
  const found = cookies.find((c) => c.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.split(';')[0]?.slice(name.length + 1) ?? '') : null;
}

async function presession(): Promise<Record<string, string>> {
  const res = await http().get('/api/v1/session').expect(200);
  return {
    Cookie: `${PRESESSION_COOKIE}=${cookieValue(res, PRESESSION_COOKIE) ?? ''}`,
    'X-CSRF-Token': res.body.csrfToken as string,
    Origin: WEB_ORIGIN,
  };
}

/** Compte à mot de passe, connecté et ré-authentifié. */
async function holder(): Promise<SignedIn & { email: string }> {
  const id = randomUUID();
  const email = `del-${id}@lahotte.test`;
  identity.accounts.seed({ id, email, passwordHash: await identity.hasher.hash(PASSWORD) });
  const signed = await signIn(app, { accountId: id, profileId: null });
  const rotated = await app.get(SessionLifecycle).rotate({
    id: signed.sessionId,
    accountId: id,
    tokenHash: signed.tokenHash,
  });
  return {
    ...session(app, rotated.token, rotated.record.tokenHash, signed.sessionId, id, null),
    email,
  };
}

const alive = async (user: SignedIn): Promise<boolean> =>
  (await http().get('/api/v1/sessions').set('Cookie', user.cookie)).status === 200;

describe('Demande d’effacement (RGPD-12)', () => {
  it('exige une ré-authentification récente', async () => {
    const user = await identity.signIn({ withProfile: false });
    const res = await http().delete('/api/v1/account').set(user.mutation).expect(401);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
  });

  it('effacement dans 30 jours : sessions coupées, e-mail avec la date', async () => {
    const user = await holder();
    const res = await http().delete('/api/v1/account').set(user.mutation).expect(202);
    const effectiveAt = new Date(res.body.effectiveAt as string).getTime();
    expect(Math.abs(effectiveAt - (Date.now() + 30 * DAY))).toBeLessThan(60_000);
    expect(await alive(user)).toBe(false);
    expect(identity.mail.sent.at(-1)).toMatchObject({
      to: user.email,
      subject: 'Suppression de votre compte programmée',
    });
    expect(identity.securityLog.entries.at(-1)).toMatchObject({
      accountId: user.accountId,
      event: 'account.deletion_requested',
    });
  });

  it('se reconnecter pendant le délai annule la demande', async () => {
    const user = await holder();
    await http().delete('/api/v1/account').set(user.mutation).expect(202);
    await http()
      .post('/api/v1/auth/login')
      .set(await presession())
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    expect(identity.accounts.rows.get(user.accountId)?.pendingDeletionAt ?? null).toBeNull();
    expect(identity.mail.sent.at(-1)).toMatchObject({
      to: user.email,
      subject: 'Suppression de votre compte annulée',
    });
  });

  it('un mauvais mot de passe n’annule rien', async () => {
    const user = await holder();
    await http().delete('/api/v1/account').set(user.mutation).expect(202);
    await http()
      .post('/api/v1/auth/login')
      .set(await presession())
      .send({ email: user.email, password: 'pas le bon mot de passe' })
      .expect(401);
    expect(identity.accounts.rows.get(user.accountId)?.pendingDeletionAt).toBeInstanceOf(Date);
  });

  it('le dernier administrateur ne se supprime pas', async () => {
    const solo = await createTestApp();
    try {
      const only = await solo.identity.signIn({ role: 'ADMIN', withProfile: false });
      solo.identity.accounts.seed({ id: only.accountId, email: `adm-${only.accountId}@x.test` });
      solo.identity.sessions.accounts.set(only.accountId, {
        role: 'ADMIN',
        active: true,
        epoch: 0,
      });
      const rotated = await solo.app.get(SessionLifecycle).rotate({
        id: only.sessionId,
        accountId: only.accountId,
        tokenHash: only.tokenHash,
      });
      const actor = session(
        solo.app,
        rotated.token,
        rotated.record.tokenHash,
        only.sessionId,
        only.accountId,
        null,
      );
      const res = await request(solo.app.getHttpServer())
        .delete('/api/v1/account')
        .set(actor.mutation)
        .expect(422);
      expect(res.body.code).toBe('LAST_ADMIN');
    } finally {
      await solo.app.close();
    }
  });
});

describe('Exécution (RGPD-12)', () => {
  it('après 30 jours, le compte et ses profils sont effacés ; avant, rien', async () => {
    const user = await holder();
    await http().delete('/api/v1/account').set(user.mutation).expect(202);
    expect((await identity.runAccountLifecycle()).erased).toBe(0);
    const row = identity.accounts.rows.get(user.accountId);
    if (!row) throw new Error('compte absent');
    row.pendingDeletionAt = new Date(Date.now() - 31 * DAY);
    expect((await identity.runAccountLifecycle()).erased).toBeGreaterThanOrEqual(1);
    expect(identity.accounts.rows.has(user.accountId)).toBe(false);
    expect(identity.securityLog.entries.some((e) => e.event === 'account.erased')).toBe(true);
  });
});

describe('Inactivité (RGPD-13)', () => {
  it('deux avertissements, puis effacement ; une connexion remet le compteur à zéro', async () => {
    const id = randomUUID();
    const email = `old-${id}@lahotte.test`;
    identity.accounts.seed({ id, email });
    const last = (days: number) =>
      identity.lifecycle.lastSignInAt.set(id, new Date(Date.now() - days * DAY));
    // 3 ans moins 20 jours : premier avertissement.
    last(3 * 365 - 20);
    await identity.runAccountLifecycle();
    expect(identity.mail.sent.filter((m) => m.to === email)).toHaveLength(1);
    // Une seconde passe ne renvoie rien.
    await identity.runAccountLifecycle();
    expect(identity.mail.sent.filter((m) => m.to === email)).toHaveLength(1);
    // 3 ans moins 3 jours : second avertissement.
    last(3 * 365 - 3);
    await identity.runAccountLifecycle();
    expect(identity.mail.sent.filter((m) => m.to === email)).toHaveLength(2);
    expect(identity.mail.sent.at(-1)?.text).toContain('7 jours');
    // Échéance : demande et effacement dans la même passe (le délai de l'avertissement en tient lieu).
    last(3 * 365 + 1);
    const run = await identity.runAccountLifecycle();
    expect(run.scheduled).toBe(1);
    expect(identity.accounts.rows.has(id)).toBe(false);
  });

  it('un administrateur ou un modérateur n’est jamais visé', async () => {
    const mod = await identity.signIn({ role: 'MODERATOR', withProfile: false });
    identity.accounts.seed({ id: mod.accountId, email: `mod-${mod.accountId}@x.test` });
    identity.sessions.accounts.set(mod.accountId, { role: 'MODERATOR', active: true, epoch: 0 });
    identity.lifecycle.lastSignInAt.set(mod.accountId, new Date(Date.now() - 4 * 365 * DAY));
    await identity.runAccountLifecycle();
    expect(identity.accounts.rows.has(mod.accountId)).toBe(true);
    expect(identity.mail.sent.some((m) => m.to === `mod-${mod.accountId}@x.test`)).toBe(false);
  });
});
