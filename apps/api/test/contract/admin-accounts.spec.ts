import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { PRESESSION_COOKIE } from '../../src/modules/identity/presentation/cookies';
import { session, signIn, type SignedIn, WEB_ORIGIN } from '../support/sign-in';
import { createTestApp, type TestAdmin, type TestIdentity } from './create-test-app';

// Comptes dans l'espace d'administration : ADM-04, ADM-06 à ADM-10, RBAC-03, RBAC-06, RBAC-07,
// AUD-05, AUD-07.

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
  admin.searchQuota.reset();
});

const http = () => request(app.getHttpServer());
const REASON = 'Signalements répétés vérifiés';

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

async function anAdmin(): Promise<SignedIn> {
  return reauthenticated(await identity.signIn({ role: 'ADMIN' }));
}

/** Compte réel des doubles (adresse, TOTP), connecté sans profil. */
async function account(input: { totp?: boolean } = {}): Promise<SignedIn & { email: string }> {
  const id = randomUUID();
  const email = `cible-${id}@lahotte.test`;
  identity.accounts.seed({ id, email, totpEnabled: input.totp ?? false });
  const signed = await signIn(app, { accountId: id, profileId: null });
  return { ...signed, email };
}

function cookieValue(res: request.Response, name: string): string | null {
  const raw = res.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(raw) ? (raw as string[]) : [];
  const found = cookies.find((c) => c.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.split(';')[0]?.slice(name.length + 1) ?? '') : null;
}

async function presession(): Promise<Record<string, string>> {
  const res = await http().get('/api/v1/session').expect(200);
  const id = cookieValue(res, PRESESSION_COOKIE) ?? '';
  return {
    Cookie: `${PRESESSION_COOKIE}=${id}`,
    'X-CSRF-Token': res.body.csrfToken as string,
    Origin: WEB_ORIGIN,
  };
}

const alive = async (user: SignedIn): Promise<boolean> =>
  (await http().get('/api/v1/sessions').set('Cookie', user.cookie)).status === 200;

describe('Recherche de compte (ADM-04, ADM-10)', () => {
  it('adresse exacte : métadonnées seulement, recherche journalisée sans l’adresse', async () => {
    const actor = await anAdmin();
    const target = await account();
    const res = await http()
      .get(`/api/v1/admin/accounts?email=${encodeURIComponent(target.email.toUpperCase())}`)
      .set('Cookie', actor.cookie)
      .expect(200);
    const found = (res.body as { account: Record<string, unknown> }).account;
    expect(Object.keys(found).sort()).toEqual(
      [
        'accountId',
        'createdAt',
        'emailVerified',
        'lastSignInAt',
        'listCount',
        'profileCount',
        'publicationSuspended',
        'role',
        'status',
        'suspensions',
        'totpEnabled',
      ].sort(),
    );
    expect(JSON.stringify(res.body)).not.toContain(target.email);
    const entry = admin.audit.rows.at(-1);
    expect(entry).toMatchObject({ action: 'account.search', actorAccountId: actor.accountId });
    expect(JSON.stringify(entry)).not.toContain(target.email);
    expect(entry?.after).toMatch(/^[0-9a-f]{64}$/);
  });

  it('adresse inconnue : rien, avec la même forme', async () => {
    const actor = await anAdmin();
    const res = await http()
      .get('/api/v1/admin/accounts?email=personne@lahotte.test')
      .set('Cookie', actor.cookie)
      .expect(200);
    expect(res.body).toEqual({ account: null });
  });

  it('20 recherches par heure, puis 429', async () => {
    const actor = await anAdmin();
    for (let i = 0; i < 20; i += 1) {
      await http()
        .get('/api/v1/admin/accounts?email=x@lahotte.test')
        .set('Cookie', actor.cookie)
        .expect(200);
    }
    const res = await http()
      .get('/api/v1/admin/accounts?email=x@lahotte.test')
      .set('Cookie', actor.cookie)
      .expect(429);
    expect(res.body.code).toBe('ACCOUNT_SEARCH_RATE_LIMITED');
  });

  it('refuse une adresse mal formée (SEC-10)', async () => {
    const actor = await anAdmin();
    await http()
      .get('/api/v1/admin/accounts?email=pas-une-adresse')
      .set('Cookie', actor.cookie)
      .expect(400);
  });
});

describe('Actions sensibles (RBAC-06)', () => {
  it('exigent une ré-authentification récente', async () => {
    const actor = await identity.signIn({ role: 'ADMIN' });
    const target = await account();
    const res = await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/suspend`)
      .set(actor.mutation)
      .send({ reason: REASON });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
  });

  it('exigent un motif de 10 à 500 caractères', async () => {
    const actor = await anAdmin();
    const target = await account();
    for (const reason of ['court', 'x'.repeat(501)]) {
      await http()
        .post(`/api/v1/admin/accounts/${target.accountId}/suspend`)
        .set(actor.mutation)
        .send({ reason })
        .expect(400);
    }
  });

  it('jamais sur son propre compte', async () => {
    const actor = await anAdmin();
    const res = await http()
      .post(`/api/v1/admin/accounts/${actor.accountId}/force-logout`)
      .set(actor.mutation)
      .send({ reason: REASON })
      .expect(422);
    expect(res.body.code).toBe('ADMIN_SELF_ACTION');
  });

  it('compte inconnu : 404', async () => {
    const actor = await anAdmin();
    await http()
      .post(`/api/v1/admin/accounts/${randomUUID()}/suspend`)
      .set(actor.mutation)
      .send({ reason: REASON })
      .expect(404);
  });
});

describe('Suspension et réactivation (ADM-06)', () => {
  it('coupe toutes les sessions, avertit le titulaire et journalise avec le motif', async () => {
    const actor = await anAdmin();
    const target = await account();
    expect(await alive(target)).toBe(true);
    await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/suspend`)
      .set(actor.mutation)
      .send({ reason: REASON })
      .expect(204);
    expect(await alive(target)).toBe(false);
    expect(identity.mail.sent.at(-1)).toMatchObject({
      to: target.email,
      subject: 'Votre compte est suspendu',
    });
    expect(identity.mail.sent.at(-1)?.text).not.toContain(REASON);
    expect(admin.audit.rows.at(-1)).toMatchObject({
      action: 'account.suspend',
      actorAccountId: actor.accountId,
      targetKind: 'ACCOUNT',
      targetId: target.accountId,
      reason: REASON,
    });
    // Déjà suspendu : conflit.
    await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/suspend`)
      .set(actor.mutation)
      .send({ reason: REASON })
      .expect(409);
    await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/reactivate`)
      .set(actor.mutation)
      .send({ reason: 'Contestation acceptée' })
      .expect(204);
    expect(identity.sessions.accounts.get(target.accountId)?.active).toBe(true);
  });

  it('ne rouvre pas un compte suspendu par la purge (AUTH-15)', async () => {
    const actor = await anAdmin();
    const target = await account();
    const state = identity.sessions.accounts.get(target.accountId);
    if (!state) throw new Error('compte absent');
    state.active = false;
    await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/reactivate`)
      .set(actor.mutation)
      .send({ reason: REASON })
      .expect(409);
  });

  it('un administrateur n’est pas suspendu tel quel', async () => {
    const actor = await anAdmin();
    const other = await identity.signIn({ role: 'ADMIN' });
    await http()
      .post(`/api/v1/admin/accounts/${other.accountId}/suspend`)
      .set(actor.mutation)
      .send({ reason: REASON })
      .expect(409);
  });

  it('si l’audit échoue, rien n’est fait (AUD-05)', async () => {
    const actor = await anAdmin();
    const target = await account();
    admin.audit.failNext = true;
    await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/suspend`)
      .set(actor.mutation)
      .send({ reason: REASON })
      .expect(500);
    expect(identity.sessions.accounts.get(target.accountId)?.active).toBe(true);
  });
});

describe('Déconnexion forcée (ADM-08)', () => {
  it('révoque toutes les sessions, rien d’autre', async () => {
    const actor = await anAdmin();
    const target = await account();
    await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/force-logout`)
      .set(actor.mutation)
      .send({ reason: REASON })
      .expect(204);
    expect(await alive(target)).toBe(false);
    expect(identity.sessions.accounts.get(target.accountId)?.active).toBe(true);
  });
});

describe('Rôles (RBAC-03, RBAC-07)', () => {
  it('refuse un rôle à un compte sans TOTP, sans dire pourquoi', async () => {
    const actor = await anAdmin();
    const target = await account();
    const res = await http()
      .put(`/api/v1/admin/accounts/${target.accountId}/role`)
      .set(actor.mutation)
      .send({ role: 'MODERATOR', reason: REASON })
      .expect(422);
    expect(res.body.code).toBe('ROLE_REQUIREMENTS_NOT_MET');
  });

  it('donne un rôle, coupe les sessions de la cible et journalise avant et après', async () => {
    const actor = await anAdmin();
    const target = await account({ totp: true });
    await http()
      .put(`/api/v1/admin/accounts/${target.accountId}/role`)
      .set(actor.mutation)
      .send({ role: 'MODERATOR', reason: REASON })
      .expect(204);
    expect(identity.sessions.accounts.get(target.accountId)?.role).toBe('MODERATOR');
    expect(await alive(target)).toBe(false);
    expect(admin.audit.rows.at(-1)).toMatchObject({
      action: 'role.grant',
      before: 'USER',
      after: 'MODERATOR',
    });
  });

  it('un administrateur ne se donne rien, mais peut retirer son rôle s’il n’est pas le dernier', async () => {
    const actor = await anAdmin();
    await http()
      .put(`/api/v1/admin/accounts/${actor.accountId}/role`)
      .set(actor.mutation)
      .send({ role: 'MODERATOR', reason: REASON })
      .expect(422);
    // D'autres administrateurs existent dans ce magasin partagé : le retrait passe.
    await http()
      .put(`/api/v1/admin/accounts/${actor.accountId}/role`)
      .set(actor.mutation)
      .send({ role: 'USER', reason: REASON })
      .expect(204);
    expect(identity.sessions.accounts.get(actor.accountId)?.role).toBe('USER');
  });

  it('le dernier administrateur garde son rôle', async () => {
    // Magasin à part : un seul administrateur.
    const solo = await createTestApp();
    try {
      const only = await solo.identity.signIn({ role: 'ADMIN' });
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
        .put(`/api/v1/admin/accounts/${actor.accountId}/role`)
        .set(actor.mutation)
        .send({ role: 'USER', reason: REASON })
        .expect(422);
      expect(res.body.code).toBe('LAST_ADMIN');
    } finally {
      await solo.app.close();
    }
  });
});

describe('Réinitialisation du TOTP (ADM-07)', () => {
  it('lien envoyé au titulaire ; à l’ouverture, TOTP retiré et sessions coupées', async () => {
    const actor = await anAdmin();
    const target = await account({ totp: true });
    await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/totp-reset`)
      .set(actor.mutation)
      .send({ reason: 'Téléphone perdu, identité vérifiée' })
      .expect(204);
    // L'administrateur ne reçoit aucun secret.
    expect(admin.audit.rows.at(-1)).toMatchObject({ action: 'account.totp_reset_requested' });
    const token = identity.mail.lastToken(target.email);
    expect(token).not.toBeNull();
    await http()
      .post('/api/v1/auth/totp/reset/confirm')
      .set(await presession())
      .send({ token })
      .expect(204);
    expect(identity.accounts.rows.get(target.accountId)?.totpEnabled).toBe(false);
    expect(await alive(target)).toBe(false);
    expect(admin.audit.rows.at(-1)).toMatchObject({
      action: 'account.totp_reset_completed',
      actorAccountId: target.accountId,
    });
    // Usage unique.
    await http()
      .post('/api/v1/auth/totp/reset/confirm')
      .set(await presession())
      .send({ token })
      .expect(422);
  });

  it('un modérateur perd d’abord son rôle (AUTH-13)', async () => {
    const actor = await anAdmin();
    const target = await account({ totp: true });
    const state = identity.sessions.accounts.get(target.accountId);
    if (!state) throw new Error('compte absent');
    state.role = 'MODERATOR';
    await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/totp-reset`)
      .set(actor.mutation)
      .send({ reason: 'Téléphone perdu, identité vérifiée' })
      .expect(204);
    expect(identity.sessions.accounts.get(target.accountId)?.role).toBe('USER');
    const actions = admin.audit.rows.slice(-2).map((r) => r.action);
    expect(actions).toEqual(['role.revoke', 'account.totp_reset_requested']);
  });

  it('un rôle rendu avant l’ouverture du lien l’annule (ADM-07)', async () => {
    const actor = await anAdmin();
    const target = await account({ totp: true });
    const state = identity.sessions.accounts.get(target.accountId);
    if (!state) throw new Error('compte absent');
    state.role = 'MODERATOR';
    await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/totp-reset`)
      .set(actor.mutation)
      .send({ reason: 'Téléphone perdu, identité vérifiée' })
      .expect(204);
    const token = identity.mail.lastToken(target.email);
    expect(token).not.toBeNull();
    await http()
      .put(`/api/v1/admin/accounts/${target.accountId}/role`)
      .set(actor.mutation)
      .send({ role: 'MODERATOR', reason: REASON })
      .expect(204);
    await http()
      .post('/api/v1/auth/totp/reset/confirm')
      .set(await presession())
      .send({ token })
      .expect(422);
    expect(identity.accounts.rows.get(target.accountId)?.totpEnabled).toBe(true);
  });

  it('un avertissement qui ne part pas laisse une entrée d’échec (AUD-05)', async () => {
    const actor = await anAdmin();
    const target = await account({ totp: true });
    await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/totp-reset`)
      .set(actor.mutation)
      .send({ reason: 'Téléphone perdu, identité vérifiée' })
      .expect(204);
    const token = identity.mail.lastToken(target.email);
    const send = identity.mail.send.bind(identity.mail);
    identity.mail.send = () => Promise.reject(new Error('relais indisponible'));
    try {
      await http()
        .post('/api/v1/auth/totp/reset/confirm')
        .set(await presession())
        .send({ token })
        .expect(204);
    } finally {
      identity.mail.send = send;
    }
    expect(admin.audit.rows.at(-1)).toMatchObject({
      action: 'followup.failed',
      targetId: target.accountId,
      after: 'account.totp_reset_completed',
    });
  });

  it('sans TOTP actif : conflit', async () => {
    const actor = await anAdmin();
    const target = await account();
    await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/totp-reset`)
      .set(actor.mutation)
      .send({ reason: 'Téléphone perdu, identité vérifiée' })
      .expect(409);
  });
});

describe('Réglages de plateforme (ADM-09)', () => {
  it('lecture, écriture validée, ancienne et nouvelle valeur au journal', async () => {
    const actor = await anAdmin();
    const read = await http().get('/api/v1/admin/settings').set('Cookie', actor.cookie).expect(200);
    expect(Object.keys(read.body as object).sort()).toEqual(
      ['blocked_domains', 'extraction_daily_limit', 'forbidden_terms', 'registration_mode'].sort(),
    );
    const res = await http()
      .put('/api/v1/admin/settings/forbidden_terms')
      .set(actor.mutation)
      .send({ value: ['Contrefaçon', 'contrefacon', 'arme'], reason: REASON })
      .expect(200);
    expect(res.body.forbidden_terms).toEqual(['arme', 'contrefacon']);
    expect(admin.audit.rows.at(-1)).toMatchObject({
      action: 'setting.update',
      targetKind: 'SETTING',
      before: { key: 'forbidden_terms', value: [] },
      after: { key: 'forbidden_terms', value: ['arme', 'contrefacon'] },
    });
    admin.settings.values = { ...admin.settings.values, forbidden_terms: [] };
  });

  it('refuse une valeur hors de la liste fermée, et une clé inconnue', async () => {
    const actor = await anAdmin();
    const res = await http()
      .put('/api/v1/admin/settings/registration_mode')
      .set(actor.mutation)
      .send({ value: 'CLOSED', reason: REASON })
      .expect(422);
    expect(res.body.code).toBe('SETTING_INVALID');
    await http()
      .put('/api/v1/admin/settings/extraction_daily_limit')
      .set(actor.mutation)
      .send({ value: 1001, reason: REASON })
      .expect(422);
    await http()
      .put('/api/v1/admin/settings/autre')
      .set(actor.mutation)
      .send({ value: 1, reason: REASON })
      .expect(400);
  });
});

describe('Côté titulaire (AUD-03, AUD-07)', () => {
  it('voit les actions faites sur son compte, sans acteur ni adresse IP', async () => {
    const actor = await anAdmin();
    const target = await account({ totp: true });
    await http()
      .post(`/api/v1/admin/accounts/${target.accountId}/totp-reset`)
      .set(actor.mutation)
      .send({ reason: 'Téléphone perdu, identité vérifiée' })
      .expect(204);
    const res = await http()
      .get('/api/v1/account/admin-actions')
      .set('Cookie', target.cookie)
      .expect(200);
    const items = (res.body as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      action: 'account.totp_reset_requested',
      at: expect.any(String),
      reason: 'Téléphone perdu, identité vérifiée',
    });
    expect(JSON.stringify(res.body)).not.toContain(actor.accountId);
  });
});
