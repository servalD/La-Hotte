import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { PRESESSION_COOKIE } from '../../src/modules/identity/presentation/cookies';
import { session, signIn, type SignedIn, WEB_ORIGIN } from '../support/sign-in';
import { createTestApp, type TestIdentity } from './create-test-app';

// Compte sous tutelle et pouvoirs du tuteur (PRO-15, PRO-16, AUTH-08, RGPD-06, LNK-06, LNK-11).

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
  identity.settings.registrationMode = 'OPEN';
});

const http = () => request(app.getHttpServer());
const PASSWORD = 'une phrase de passe assez longue';

/** Compte vérifié (base mémoire) avec un profil adulte actif. */
async function person(): Promise<SignedIn> {
  const user = await identity.signIn();
  identity.accounts.seed({ id: user.accountId, email: `t-${user.accountId}@lahotte.test` });
  return user;
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

async function presession(): Promise<Record<string, string>> {
  const res = await http().get('/api/v1/session').expect(200);
  const cookies = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const id = cookies
    .find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))
    ?.split(';')[0]
    ?.slice(PRESESSION_COOKIE.length + 1);
  return {
    Cookie: `${PRESESSION_COOKIE}=${id ?? ''}`,
    'X-CSRF-Token': res.body.csrfToken as string,
    Origin: WEB_ORIGIN,
  };
}

function wardEmail(): string {
  return `ward-${randomUUID()}@lahotte.test`;
}

/** Demande de création, puis le jeton reçu à l'adresse (après les tâches de fond). */
async function requestWard(tutor: SignedIn, email: string, profileName = 'Léa'): Promise<string> {
  await http()
    .post('/api/v1/account/wards')
    .set(tutor.mutation)
    .send({ email, profileName, guardianAttested: true })
    .expect(204);
  await identity.background.flush();
  const token = identity.mail.lastToken(email);
  if (!token) throw new Error('lien d’installation attendu');
  return token;
}

/** Compte sous tutelle installé : son identifiant et celui de son profil. */
async function installedWard(
  tutor: SignedIn,
): Promise<{ accountId: string; profileId: string; email: string }> {
  const email = wardEmail();
  const token = await requestWard(tutor, email);
  await http()
    .post('/api/v1/accounts/setup')
    .set(await presession())
    .send({ token, password: PASSWORD })
    .expect(204);
  const account = await identity.accounts.findByEmail(email);
  if (!account) throw new Error('compte attendu');
  const profile = [...identity.accounts.profiles.values()].find(
    (p) => p.accountId === account.accountId,
  );
  if (!profile) throw new Error('profil attendu');
  return { accountId: account.accountId, profileId: profile.id, email };
}

describe('POST /account/wards (PRO-15)', () => {
  it('exige une ré-authentification récente et la déclaration d’autorité parentale', async () => {
    const tutor = await person();
    const email = wardEmail();
    await http()
      .post('/api/v1/account/wards')
      .set(tutor.mutation)
      .send({ email, profileName: 'Léa', guardianAttested: true })
      .expect(401);
    const fresh = await reauthenticated(tutor);
    await http()
      .post('/api/v1/account/wards')
      .set(fresh.mutation)
      .send({ email, profileName: 'Léa', guardianAttested: false })
      .expect(400);
  });

  it('envoie un lien d’installation à l’adresse, sans nom dans le corps', async () => {
    const tutor = await reauthenticated(await person());
    const email = wardEmail();
    await requestWard(tutor, email, 'Léa');
    const mail = identity.mail.sent.filter((m) => m.to === email).at(-1);
    expect(mail?.text).toContain('/accounts/setup#');
    expect(mail?.text).not.toContain('Léa');
    expect(
      identity.securityLog.entries.some(
        (e) => e.event === 'ward.setup_requested' && e.accountId === tutor.accountId,
      ),
    ).toBe(true);
  });

  it('AUTH-09 : une adresse déjà inscrite reçoit un avertissement, et la réponse est la même', async () => {
    const tutor = await reauthenticated(await person());
    const owner = await person();
    const email = `t-${owner.accountId}@lahotte.test`;
    await http()
      .post('/api/v1/account/wards')
      .set(tutor.mutation)
      .send({ email, profileName: 'Léa', guardianAttested: true })
      .expect(204);
    await identity.background.flush();
    const mail = identity.mail.sent.filter((m) => m.to === email).at(-1);
    expect(mail?.subject).toBe('Tentative d’utilisation de votre adresse');
    expect(identity.mail.lastToken(email)).toBeNull();
  });

  it('PRO-15 : un compte sous tutelle n’en crée pas (pas de chaîne)', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    const wardSession = await reauthenticated(
      await signIn(app, { accountId: ward.accountId, profileId: ward.profileId }),
    );
    const res = await http()
      .post('/api/v1/account/wards')
      .set(wardSession.mutation)
      .send({ email: wardEmail(), profileName: 'Tom', guardianAttested: true })
      .expect(403);
    expect(res.body.code).toBe('WARD_CHILD_ONLY');
  });
});

describe('POST /accounts/setup (PRO-15)', () => {
  it('le compte naît vérifié, sous tutelle, avec un profil enfant lié au tuteur', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    expect(identity.accounts.rows.get(ward.accountId)?.guardianAccountId).toBe(tutor.accountId);
    expect(identity.accounts.rows.get(ward.accountId)?.emailVerifiedAt).not.toBeNull();
    expect(identity.accounts.profiles.get(ward.profileId)?.isChild).toBe(true);
    const guardianship = identity.links
      .linksOf(ward.profileId)
      .filter((l) => l.otherId === tutor.profileId);
    expect(guardianship).toEqual([
      expect.objectContaining({ origin: 'GUARDIANSHIP', status: 'ACCEPTED' }),
    ]);
    for (const accountId of [tutor.accountId, ward.accountId]) {
      expect(
        identity.securityLog.entries.some(
          (e) => e.event === 'ward.created' && e.accountId === accountId,
        ),
      ).toBe(true);
    }
  });

  it('un lien rejoué, inconnu ou mal formé reçoit le même refus', async () => {
    const tutor = await reauthenticated(await person());
    const email = wardEmail();
    const token = await requestWard(tutor, email);
    await http()
      .post('/api/v1/accounts/setup')
      .set(await presession())
      .send({ token, password: PASSWORD })
      .expect(204);
    for (const replayed of [token, 'A'.repeat(43)]) {
      const res = await http()
        .post('/api/v1/accounts/setup')
        .set(await presession())
        .send({ token: replayed, password: PASSWORD })
        .expect(404);
      expect(res.body.code).toBe('ACCOUNT_SETUP_INVALID');
    }
  });

  it('le compte sous tutelle se connecte seul avec le mot de passe choisi', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    await http()
      .post('/api/v1/auth/login')
      .set(await presession())
      .send({ email: ward.email, password: PASSWORD })
      .expect(200);
  });
});

describe('restrictions du compte sous tutelle (PRO-15)', () => {
  it('ni profil adulte, ni changement de marqueur ; un profil enfant naît lié au tuteur', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    const wardSession = await reauthenticated(
      await signIn(app, { accountId: ward.accountId, profileId: ward.profileId }),
    );
    const adult = await http()
      .post('/api/v1/account/profiles')
      .set(wardSession.mutation)
      .send({ displayName: 'Adulte', isChild: false })
      .expect(403);
    expect(adult.body.code).toBe('WARD_CHILD_ONLY');
    const marker = await http()
      .put(`/api/v1/account/profiles/${ward.profileId}/child`)
      .set(wardSession.mutation)
      .send({ isChild: false })
      .expect(403);
    expect(marker.body.code).toBe('WARD_CHILD_ONLY');
    const sibling = await http()
      .post('/api/v1/account/profiles')
      .set(wardSession.mutation)
      .send({ displayName: 'Tom', isChild: true })
      .expect(201);
    expect(
      identity.links
        .linksOf(sibling.body.id as string)
        .some((l) => l.otherId === tutor.profileId && l.origin === 'GUARDIANSHIP'),
    ).toBe(true);
  });

  it('LNK-06 : le tuteur valide le lien de l’enfant ; un lien de tutelle ne se rompt pas depuis l’enfant', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    const kid = await signIn(app, { accountId: ward.accountId, profileId: ward.profileId });
    const friend = await person();
    const invitation = await http()
      .post('/api/v1/invitations')
      .set(kid.mutation)
      .send({})
      .expect(201);
    const redeemed = await http()
      .post('/api/v1/invitations/redeem')
      .set(friend.mutation)
      .send({ token: invitation.body.token })
      .expect(201);
    expect(redeemed.body.status).toBe('AWAITING_GUARDIAN');
    const tutorLinks = await http().get('/api/v1/links').set({ Cookie: tutor.cookie }).expect(200);
    const pending = (tutorLinks.body.items as { id: string; awaitingMyApproval: boolean }[]).find(
      (l) => l.id === redeemed.body.linkId,
    );
    expect(pending?.awaitingMyApproval).toBe(true);
    await http()
      .post(`/api/v1/links/${redeemed.body.linkId as string}/approve`)
      .set(tutor.mutation)
      .expect(204);

    const guardianship = identity.links
      .linksOf(ward.profileId)
      .find((l) => l.origin === 'GUARDIANSHIP');
    if (!guardianship) throw new Error('lien de tutelle attendu');
    await http().delete(`/api/v1/links/${guardianship.id}`).set(kid.mutation).expect(404);
    const last = await http()
      .delete(`/api/v1/links/${guardianship.id}`)
      .set(tutor.mutation)
      .expect(422);
    expect(last.body.code).toBe('GUARDIAN_REQUIRED');
    await http()
      .post('/api/v1/blocks')
      .set(kid.mutation)
      .send({ profileId: tutor.profileId })
      .expect(404);
  });

  it('GUARDIAN_REQUIRED : le seul tuteur ne devient pas enfant', async () => {
    const tutor = await reauthenticated(await person());
    await installedWard(tutor);
    // Un second adulte, sans lien de tutelle : le compte tuteur garde un adulte, pas l'enfant.
    const otherAdult = randomUUID();
    identity.profiles.set({
      profileId: otherAdult,
      accountId: tutor.accountId,
      hasPin: false,
      relock: 'IDLE_15',
    });
    const res = await http()
      .put(`/api/v1/account/profiles/${tutor.profileId}/child`)
      .set(tutor.mutation)
      .send({ isChild: true })
      .expect(422);
    expect(res.body.code).toBe('GUARDIAN_REQUIRED');
  });
});

describe('pouvoirs du tuteur (PRO-16)', () => {
  it('métadonnées seulement, forme figée ; un autre tuteur reçoit 404', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    const listed = await http()
      .get('/api/v1/account/wards')
      .set({ Cookie: tutor.cookie })
      .expect(200);
    const [item] = listed.body.items as Record<string, unknown>[];
    expect(Object.keys(item ?? {}).sort()).toEqual(
      ['createdAt', 'email', 'id', 'profiles', 'releaseRequested'].sort(),
    );
    const [profile] = (item?.profiles ?? []) as Record<string, unknown>[];
    expect(Object.keys(profile ?? {}).sort()).toEqual(
      ['accentColor', 'avatar', 'displayName', 'hasPin', 'id', 'isChild'].sort(),
    );
    const detail = await http()
      .get(`/api/v1/account/wards/${ward.accountId}`)
      .set({ Cookie: tutor.cookie })
      .expect(200);
    expect(Object.keys(detail.body as object).sort()).toEqual(
      ['createdAt', 'email', 'id', 'profiles', 'releaseRequested', 'sessions'].sort(),
    );

    const stranger = await reauthenticated(await person());
    const res = await http()
      .get(`/api/v1/account/wards/${ward.accountId}`)
      .set({ Cookie: stranger.cookie })
      .expect(404);
    expect(res.body.code).toBe('WARD_NOT_FOUND');
  });

  it('déconnecte tous les appareils du compte sous tutelle, qui en est averti', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    const kid = await signIn(app, { accountId: ward.accountId, profileId: ward.profileId });
    await http()
      .delete(`/api/v1/account/wards/${ward.accountId}/sessions`)
      .set(tutor.mutation)
      .expect(204);
    await http().get('/api/v1/sessions').set({ Cookie: kid.cookie }).expect(401);
    await identity.background.flush();
    expect(identity.mail.sent.filter((m) => m.to === ward.email).at(-1)?.subject).toBe(
      'Action de votre tuteur sur votre compte',
    );
  });

  it('le lien de réinitialisation part à l’adresse du tuteur, et sert', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    const tutorEmail = `t-${tutor.accountId}@lahotte.test`;
    await http()
      .post(`/api/v1/account/wards/${ward.accountId}/password-reset`)
      .set(tutor.mutation)
      .expect(204);
    await identity.background.flush();
    const token = identity.mail.lastToken(tutorEmail);
    expect(token).not.toBeNull();
    expect(identity.mail.lastToken(ward.email)).not.toBe(token);
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set(await presession())
      .send({ token, newPassword: 'la phrase choisie par le tuteur' })
      .expect(204);
    await http()
      .post('/api/v1/auth/login')
      .set(await presession())
      .send({ email: ward.email, password: 'la phrase choisie par le tuteur' })
      .expect(200);
  });

  it('ajoute un profil enfant au compte sous tutelle', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    const res = await http()
      .post(`/api/v1/account/wards/${ward.accountId}/profiles`)
      .set(tutor.mutation)
      .send({ displayName: 'Tom' })
      .expect(201);
    expect(identity.accounts.profiles.get(res.body.profileId as string)?.isChild).toBe(true);
  });

  it('chaque route exige une ré-authentification récente', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    const stale = await person();
    for (const call of [
      http().get('/api/v1/account/wards').set({ Cookie: stale.cookie }),
      http().get(`/api/v1/account/wards/${ward.accountId}`).set({ Cookie: stale.cookie }),
      http().delete(`/api/v1/account/wards/${ward.accountId}/sessions`).set(stale.mutation),
    ]) {
      await call.expect(401);
    }
  });
});

describe('levée de la tutelle (PRO-16, AUTH-08)', () => {
  it('demandée par le tuteur, effective à la déclaration d’âge du compte', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    const kid = await reauthenticated(
      await signIn(app, { accountId: ward.accountId, profileId: ward.profileId }),
    );
    const early = await http()
      .post('/api/v1/account/age-attestation')
      .set(kid.mutation)
      .send({ ageAttested: true })
      .expect(409);
    expect(early.body.code).toBe('WARD_RELEASE_NOT_REQUESTED');

    await http()
      .post(`/api/v1/account/wards/${ward.accountId}/password-reset`)
      .set(tutor.mutation)
      .expect(204);
    await identity.background.flush();
    const tutorToken = identity.mail.lastToken(`t-${tutor.accountId}@lahotte.test`);

    await http()
      .post(`/api/v1/account/wards/${ward.accountId}/release`)
      .set(tutor.mutation)
      .expect(204);
    await http()
      .post('/api/v1/account/age-attestation')
      .set(kid.mutation)
      .send({ ageAttested: true })
      .expect(204);

    expect(identity.accounts.rows.get(ward.accountId)?.guardianAccountId ?? null).toBeNull();
    expect(identity.accounts.profiles.get(ward.profileId)?.isChild).toBe(false);
    expect(identity.links.linksOf(ward.profileId).some((l) => l.origin === 'GUARDIANSHIP')).toBe(
      false,
    );
    await http()
      .get(`/api/v1/account/wards/${ward.accountId}`)
      .set({ Cookie: tutor.cookie })
      .expect(404);
    // I7 (cycle 1) : un jeton émis par le tuteur ne sert plus.
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set(await presession())
      .send({ token: tutorToken, newPassword: 'le tuteur reprend la main' })
      .expect(422);
  });

  it('seulement pour un compte à un seul profil', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    await http()
      .post(`/api/v1/account/wards/${ward.accountId}/profiles`)
      .set(tutor.mutation)
      .send({ displayName: 'Tom' })
      .expect(201);
    const res = await http()
      .post(`/api/v1/account/wards/${ward.accountId}/release`)
      .set(tutor.mutation)
      .expect(422);
    expect(res.body.code).toBe('WARD_RELEASE_SINGLE_PROFILE');
  });
});

describe('avis au tuteur (PRO-16)', () => {
  it('le tuteur est averti d’un changement de mot de passe du compte sous tutelle', async () => {
    const tutor = await reauthenticated(await person());
    const ward = await installedWard(tutor);
    const kid = await reauthenticated(
      await signIn(app, { accountId: ward.accountId, profileId: ward.profileId }),
    );
    await http()
      .put('/api/v1/auth/password')
      .set(kid.mutation)
      .send({ newPassword: 'une autre phrase de passe' })
      .expect(200);
    await identity.background.flush();
    expect(
      identity.mail.sent.filter((m) => m.to === `t-${tutor.accountId}@lahotte.test`).at(-1)
        ?.subject,
    ).toBe('Changement sur un compte sous votre tutelle');
  });
});
