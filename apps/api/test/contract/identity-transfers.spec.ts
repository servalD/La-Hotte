import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RunDueTransfers } from '../../src/modules/identity/application/contract';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { PRESESSION_COOKIE } from '../../src/modules/identity/presentation/cookies';
import { session, signIn, type SignedIn, WEB_ORIGIN } from '../support/sign-in';
import { createTestApp, type TestIdentity } from './create-test-app';

// Passage, regroupement et détachement d'un profil (PRO-12 à PRO-14, LNK-11).

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
const DAY = 24 * 60 * 60 * 1000;

async function account(displayName = 'Adulte'): Promise<SignedIn> {
  const user = await identity.signIn({ displayName });
  identity.accounts.seed({ id: user.accountId, email: `t-${user.accountId}@lahotte.test` });
  return user;
}

/** Profil ajouté au compte de `owner`, avec sa propre session (sans PIN, donc déverrouillé). */
async function addProfile(
  owner: SignedIn,
  options: { displayName?: string; isChild?: boolean } = {},
): Promise<SignedIn> {
  const profileId = randomUUID();
  identity.profiles.set({
    profileId,
    accountId: owner.accountId,
    hasPin: false,
    relock: 'IDLE_15',
  });
  const created = identity.accounts.profiles.get(profileId);
  if (created) {
    identity.accounts.profiles.set(profileId, {
      ...created,
      displayName: options.displayName ?? 'Ado',
      isChild: options.isChild ?? false,
    });
  }
  return signIn(app, { accountId: owner.accountId, profileId });
}

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

/** Lien `ACCEPTED` entre deux profils de comptes différents. */
async function link(x: SignedIn, y: SignedIn): Promise<void> {
  const invitation = await http().post('/api/v1/invitations').set(x.mutation).send({}).expect(201);
  await http()
    .post('/api/v1/invitations/redeem')
    .set(y.mutation)
    .send({ token: invitation.body.token })
    .expect(201);
}

/**
 * Famille A (le profil `mover` qui part et `stayer` qui reste) et famille B (`host`, lié à
 * `mover`). `origin` : session de l'espace Compte de A, ré-authentifiée.
 */
async function families() {
  const stayer = await account('Reste');
  const mover = await addProfile(stayer, { displayName: 'Part' });
  const host = await account('Accueille');
  await link(mover, host);
  return { stayer, mover, host, origin: await reauthenticated(stayer) };
}

function requestMove(origin: SignedIn, profileId: string, body: Record<string, unknown> = {}) {
  return http()
    .post(`/api/v1/account/profiles/${profileId}/transfer`)
    .set(origin.mutation)
    .send({ kind: 'MOVE', ...body });
}

/** Rend l'échéance passée, puis lance la tâche planifiée. */
async function runDue(profileId: string): Promise<void> {
  for (const t of identity.transfers.transfers.values()) {
    // Juste passée : jamais avant la création de la demande (repère du lien d'installation).
    if (t.profileId === profileId && t.executesAt) t.executesAt = new Date(Date.now() - 1);
  }
  await app.get(RunDueTransfers).execute();
  await identity.background.flush();
}

describe('passage vers un compte existant (PRO-12, PRO-14, LNK-11)', () => {
  it('trois accords, 48 heures, puis le profil change de compte avec ses effets', async () => {
    const { stayer, mover, host, origin } = await families();
    const requested = await requestMove(origin, mover.profileId ?? '').expect(201);
    expect(requested.body.token).toEqual(expect.any(String));

    // Le profil voit la demande à son entrée ; PIN proposé par défaut (il n'en a pas).
    const own = await http().get('/api/v1/profiles/me/transfer').set({ Cookie: mover.cookie });
    expect(own.body.transfer).toMatchObject({ kind: 'MOVE', pinChoice: 'NEW', executesAt: null });
    await http()
      .post('/api/v1/profiles/me/transfer/consent')
      .set(mover.mutation)
      .send({ pinChoice: 'NEW', newPin: '1357' })
      .expect(204);

    const preview = await http()
      .post('/api/v1/account/transfers/inspect')
      .set(host.mutation)
      .send({ token: requested.body.token })
      .expect(200);
    expect(preview.body).toMatchObject({ profileName: 'Part', isChild: false });
    await http()
      .post('/api/v1/account/transfers/accept')
      .set(host.mutation)
      .send({ token: requested.body.token })
      .expect(401);
    const hostFresh = await reauthenticated(host);
    await http()
      .post('/api/v1/account/transfers/accept')
      .set(hostFresh.mutation)
      .send({ token: requested.body.token })
      .expect(204);
    const after = await http().get('/api/v1/profiles/me/transfer').set({ Cookie: mover.cookie });
    expect(after.body.transfer.executesAt).not.toBeNull();
    expect(after.body.transfer.destinationNames).toEqual(['Accueille']);

    // Pas avant l'échéance.
    await app.get(RunDueTransfers).execute();
    expect(identity.accounts.profiles.get(mover.profileId ?? '')?.accountId).toBe(stayer.accountId);

    await runDue(mover.profileId ?? '');
    const moved = identity.accounts.profiles.get(mover.profileId ?? '');
    expect(moved?.accountId).toBe(host.accountId);
    expect(moved?.pinHash).toBeTruthy();
    // LNK-11 : lien interne supprimé, lien d'office avec la famille quittée.
    const links = identity.links.linksOf(mover.profileId ?? '');
    expect(links.some((l) => l.otherId === host.profileId)).toBe(false);
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          otherId: stayer.profileId,
          origin: 'TRANSFER',
          status: 'ACCEPTED',
        }),
      ]),
    );
    // PRO-14 : la session d'origine n'a plus ce profil actif.
    expect(identity.sessions.rows.get(mover.sessionId)?.activeProfileId ?? null).toBeNull();
    for (const accountId of [stayer.accountId, host.accountId]) {
      expect(
        identity.securityLog.entries.some(
          (e) => e.event === 'profile.transfer_completed' && e.accountId === accountId,
        ),
      ).toBe(true);
    }
  });

  it('un compte sans profil du cercle, ou qui porte un blocage, reçoit le refus commun', async () => {
    const { mover, host, origin } = await families();
    const requested = await requestMove(origin, mover.profileId ?? '').expect(201);
    const stranger = await account('Inconnu');
    const refused = await http()
      .post('/api/v1/account/transfers/inspect')
      .set(stranger.mutation)
      .send({ token: requested.body.token })
      .expect(404);
    expect(refused.body.code).toBe('TRANSFER_INVALID');

    const sibling = await addProfile(host, { displayName: 'Bloque' });
    identity.links.blocks.push({
      id: randomUUID(),
      blockerId: sibling.profileId ?? '',
      blockedId: mover.profileId ?? '',
      createdAt: new Date(),
    });
    await http()
      .post('/api/v1/account/transfers/inspect')
      .set(host.mutation)
      .send({ token: requested.body.token })
      .expect(404);
  });

  it('un seul passage ouvert par profil ; le profil peut refuser', async () => {
    const { mover, origin } = await families();
    await requestMove(origin, mover.profileId ?? '').expect(201);
    const twice = await requestMove(origin, mover.profileId ?? '').expect(409);
    expect(twice.body.code).toBe('TRANSFER_PENDING');
    await http().delete('/api/v1/profiles/me/transfer').set(mover.mutation).expect(204);
    await requestMove(origin, mover.profileId ?? '').expect(201);
  });

  it('B4 bis : l’accord du profil est refusé 7 jours après une réinitialisation de son PIN', async () => {
    const { mover, origin } = await families();
    await requestMove(origin, mover.profileId ?? '').expect(201);
    const profile = identity.accounts.profiles.get(mover.profileId ?? '');
    if (profile) profile.pinResetAt = new Date(Date.now() - 3 * DAY);
    const res = await http()
      .post('/api/v1/profiles/me/transfer/consent')
      .set(mover.mutation)
      .send({ pinChoice: 'NONE' })
      .expect(422);
    expect(res.body.code).toBe('TRANSFER_CONSENT_UNSAFE');
  });

  it('le compte d’arrivée retire son acceptation ; un échec d’exécution se voit pareil', async () => {
    const { mover, host, origin } = await families();
    const requested = await requestMove(origin, mover.profileId ?? '').expect(201);
    await http()
      .post('/api/v1/profiles/me/transfer/consent')
      .set(mover.mutation)
      .send({ pinChoice: 'NONE' })
      .expect(204);
    const hostFresh = await reauthenticated(host);
    await http()
      .post('/api/v1/account/transfers/accept')
      .set(hostFresh.mutation)
      .send({ token: requested.body.token })
      .expect(204);
    const incoming = await http()
      .get('/api/v1/account/transfers')
      .set({ Cookie: hostFresh.cookie })
      .expect(200);
    await http()
      .delete(`/api/v1/account/transfers/${incoming.body.items[0].id as string}/acceptance`)
      .set(hostFresh.mutation)
      .expect(204);
    const withdrawn = await http()
      .get('/api/v1/profiles/me/transfer')
      .set({ Cookie: mover.cookie });
    expect(withdrawn.body.transfer).toMatchObject({ destinationAccepted: false, executesAt: null });

    // Nouvelle acceptation, puis un blocage avant l'échéance : l'exécution échoue.
    await http()
      .post('/api/v1/account/transfers/accept')
      .set(hostFresh.mutation)
      .send({ token: requested.body.token })
      .expect(204);
    identity.links.blocks.push({
      id: randomUUID(),
      blockerId: host.profileId ?? '',
      blockedId: mover.profileId ?? '',
      createdAt: new Date(),
    });
    await runDue(mover.profileId ?? '');
    const failed = await http().get('/api/v1/profiles/me/transfer').set({ Cookie: mover.cookie });
    expect(failed.body.transfer).toMatchObject({ destinationAccepted: false });
  });
});

describe('garde-fous du départ (PRO-12, PRO-13)', () => {
  it('le dernier profil ne part que par un regroupement déclaré, qui supprime le compte', async () => {
    const lone = await account('Seul');
    const host = await account('Conjoint');
    await link(lone, host);
    const origin = await reauthenticated(lone);
    const undeclared = await requestMove(origin, lone.profileId ?? '').expect(422);
    expect(undeclared.body.code).toBe('LAST_PROFILE');
    const requested = await requestMove(origin, lone.profileId ?? '', { regroup: true }).expect(
      201,
    );
    // La ré-authentification a fait tourner le jeton : la session de `lone` est désormais `origin`.
    await http()
      .post('/api/v1/profiles/me/transfer/consent')
      .set(origin.mutation)
      .send({ pinChoice: 'NONE' })
      .expect(204);
    const hostFresh = await reauthenticated(host);
    await http()
      .post('/api/v1/account/transfers/accept')
      .set(hostFresh.mutation)
      .send({ token: requested.body.token })
      .expect(204);
    await runDue(lone.profileId ?? '');
    expect(identity.accounts.profiles.get(lone.profileId ?? '')?.accountId).toBe(host.accountId);
    expect(identity.accounts.rows.has(lone.accountId)).toBe(false);
  });

  it('un départ qui laisserait des enfants seuls est refusé (GUARDIAN_REQUIRED)', async () => {
    const parent = await account('Parent');
    await addProfile(parent, { displayName: 'Enfant', isChild: true });
    const origin = await reauthenticated(parent);
    const res = await requestMove(origin, parent.profileId ?? '').expect(422);
    expect(res.body.code).toBe('GUARDIAN_REQUIRED');
  });

  it('un enfant passe sans son accord, avec le PIN saisi par la demande', async () => {
    const parent = await account('Parent');
    const kid = await addProfile(parent, { displayName: 'Enfant', isChild: true });
    const host = await account('Grand-parent');
    await link(kid, host);
    const guardian = await signIn(app, {
      accountId: parent.accountId,
      profileId: parent.profileId,
    });
    const approvals = await http().get('/api/v1/links').set({ Cookie: guardian.cookie });
    for (const item of approvals.body.items as { id: string; awaitingMyApproval: boolean }[]) {
      if (item.awaitingMyApproval) {
        await http().post(`/api/v1/links/${item.id}/approve`).set(guardian.mutation).expect(204);
      }
    }
    const origin = await reauthenticated(parent);
    const missingPin = await requestMove(origin, kid.profileId ?? '', { pinChoice: 'NEW' }).expect(
      422,
    );
    expect(missingPin.body.code).toBe('TRANSFER_PIN_CHOICE_INVALID');
    const requested = await requestMove(origin, kid.profileId ?? '', {
      pinChoice: 'NEW',
      newPin: '2468',
    }).expect(201);
    const hostFresh = await reauthenticated(host);
    await http()
      .post('/api/v1/account/transfers/accept')
      .set(hostFresh.mutation)
      .send({ token: requested.body.token })
      .expect(204);
    await runDue(kid.profileId ?? '');
    expect(identity.accounts.profiles.get(kid.profileId ?? '')?.accountId).toBe(host.accountId);
  });

  it('un compte sous tutelle ne demande pas de passage lui-même', async () => {
    const tutor = await account('Tuteur');
    const wardAccountId = randomUUID();
    identity.accounts.seed({
      id: wardAccountId,
      email: `w-${wardAccountId}@lahotte.test`,
      guardianAccountId: tutor.accountId,
    });
    const wardProfile = randomUUID();
    identity.profiles.set({
      profileId: wardProfile,
      accountId: wardAccountId,
      hasPin: false,
      relock: 'IDLE_15',
    });
    const kid = await reauthenticated(
      await signIn(app, { accountId: wardAccountId, profileId: wardProfile }),
    );
    const res = await requestMove(kid, wardProfile).expect(403);
    expect(res.body.code).toBe('WARD_CHILD_ONLY');
  });
});

describe('détachement en nouveau compte (PRO-13)', () => {
  it('accord du profil, 48 heures, lien d’installation, déclaration d’âge, nouveau compte', async () => {
    const stayer = await account('Parent');
    const mover = await addProfile(stayer, { displayName: 'Majeur' });
    const origin = await reauthenticated(stayer);
    const email = `nouveau-${randomUUID()}@lahotte.test`;
    const requested = await http()
      .post(`/api/v1/account/profiles/${mover.profileId ?? ''}/transfer`)
      .set(origin.mutation)
      .send({ kind: 'DETACH', email })
      .expect(201);
    expect(requested.body.token).toBeNull();
    const own = await http().get('/api/v1/profiles/me/transfer').set({ Cookie: mover.cookie });
    expect(own.body.transfer).toMatchObject({ kind: 'DETACH', newEmail: email });
    await http()
      .post('/api/v1/profiles/me/transfer/consent')
      .set(mover.mutation)
      .send({ pinChoice: 'NONE' })
      .expect(204);

    await runDue(mover.profileId ?? '');
    const token = identity.mail.lastToken(email);
    expect(token).not.toBeNull();
    const noAge = await http()
      .post('/api/v1/accounts/setup')
      .set(await presession())
      .send({ token, password: 'une phrase de passe assez longue' })
      .expect(422);
    expect(noAge.body.code).toBe('AGE_ATTESTATION_REQUIRED');
    await http()
      .post('/api/v1/accounts/setup')
      .set(await presession())
      .send({ token, password: 'une phrase de passe assez longue', ageAttested: true })
      .expect(204);

    const created = await identity.accounts.findByEmail(email);
    expect(created?.emailVerified).toBe(true);
    expect(identity.accounts.profiles.get(mover.profileId ?? '')?.accountId).toBe(
      created?.accountId,
    );
    expect(
      identity.links
        .linksOf(mover.profileId ?? '')
        .some((l) => l.otherId === stayer.profileId && l.origin === 'TRANSFER'),
    ).toBe(true);
  });

  it('refusé à un profil enfant et au dernier profil', async () => {
    const parent = await account('Parent');
    const kid = await addProfile(parent, { displayName: 'Enfant', isChild: true });
    const origin = await reauthenticated(parent);
    const child = await http()
      .post(`/api/v1/account/profiles/${kid.profileId ?? ''}/transfer`)
      .set(origin.mutation)
      .send({ kind: 'DETACH', email: 'kid@lahotte.test' })
      .expect(422);
    expect(child.body.code).toBe('DETACH_CHILD_FORBIDDEN');

    const lone = await reauthenticated(await account('Seul'));
    const last = await http()
      .post(`/api/v1/account/profiles/${lone.profileId ?? ''}/transfer`)
      .set(lone.mutation)
      .send({ kind: 'DETACH', email: 'seul@lahotte.test' })
      .expect(422);
    expect(last.body.code).toBe('LAST_PROFILE');
  });
});

describe('accord et annulation par e-mail (PRO-12)', () => {
  it('lien d’accord à l’adresse vérifiée ; refusé si l’adresse a moins de 7 jours', async () => {
    const { mover, origin } = await families();
    const email = `part-${randomUUID()}@lahotte.test`;
    const profile = identity.accounts.profiles.get(mover.profileId ?? '');
    if (profile) {
      profile.email = email;
      profile.emailVerifiedAt = new Date(Date.now() - 2 * DAY);
    }
    await requestMove(origin, mover.profileId ?? '').expect(201);
    await identity.background.flush();
    const token = identity.mail.lastToken(email);
    expect(token).not.toBeNull();
    const recent = await http()
      .post('/api/v1/transfers/consent')
      .set(await presession())
      .send({ token, pinChoice: 'NONE' })
      .expect(422);
    expect(recent.body.code).toBe('TRANSFER_CONSENT_UNSAFE');
    if (profile) profile.emailVerifiedAt = new Date(Date.now() - 10 * DAY);
    await http()
      .post('/api/v1/transfers/consent')
      .set(await presession())
      .send({ token, pinChoice: 'NONE' })
      .expect(204);
  });

  it('le lien d’annulation envoyé au dernier accord annule le passage', async () => {
    const { mover, host, origin } = await families();
    const email = `part-${randomUUID()}@lahotte.test`;
    const profile = identity.accounts.profiles.get(mover.profileId ?? '');
    if (profile) {
      profile.email = email;
      profile.emailVerifiedAt = new Date(Date.now() - 10 * DAY);
    }
    const requested = await requestMove(origin, mover.profileId ?? '').expect(201);
    await http()
      .post('/api/v1/profiles/me/transfer/consent')
      .set(mover.mutation)
      .send({ pinChoice: 'NONE' })
      .expect(204);
    const hostFresh = await reauthenticated(host);
    await http()
      .post('/api/v1/account/transfers/accept')
      .set(hostFresh.mutation)
      .send({ token: requested.body.token })
      .expect(204);
    await identity.background.flush();
    const cancel = identity.mail.sent.filter((m) => m.to === email).at(-1);
    expect(cancel?.text).toContain('/transfers/cancel#');
    await http()
      .post('/api/v1/transfers/cancel')
      .set(await presession())
      .send({ token: identity.mail.lastToken(email) })
      .expect(204);
    const after = await http().get('/api/v1/profiles/me/transfer').set({ Cookie: mover.cookie });
    expect(after.body.transfer).toBeNull();
  });
});

describe('revue SEC-40 du code (cycle 1)', () => {
  it('I1 : un détachement au lien expiré est clos, le profil peut redemander', async () => {
    const stayer = await account('Parent');
    const mover = await addProfile(stayer, { displayName: 'Majeur' });
    const origin = await reauthenticated(stayer);
    await http()
      .post(`/api/v1/account/profiles/${mover.profileId ?? ''}/transfer`)
      .set(origin.mutation)
      .send({ kind: 'DETACH', email: `x-${randomUUID()}@lahotte.test` })
      .expect(201);
    await http()
      .post('/api/v1/profiles/me/transfer/consent')
      .set(mover.mutation)
      .send({ pinChoice: 'NONE' })
      .expect(204);
    await runDue(mover.profileId ?? '');
    // Le lien d'installation expire sans être servi.
    for (const t of identity.transfers.transfers.values()) {
      if (t.profileId !== mover.profileId) continue;
      // Échéance bien avant le lien, lien expiré : sans égalité à la milliseconde près.
      t.executesAt = new Date(Date.now() - 10_000);
      t.tokenExpiresAt = new Date(Date.now() - 1);
    }
    await app.get(RunDueTransfers).execute();
    const own = await http().get('/api/v1/profiles/me/transfer').set({ Cookie: mover.cookie });
    expect(own.body.transfer).toBeNull();
    await http()
      .post(`/api/v1/account/profiles/${mover.profileId ?? ''}/transfer`)
      .set(origin.mutation)
      .send({ kind: 'DETACH', email: `y-${randomUUID()}@lahotte.test` })
      .expect(201);
  });

  it('M1 : un regroupement ne se déclare pas pour un détachement', async () => {
    const stayer = await account('Parent');
    const mover = await addProfile(stayer, { displayName: 'Majeur' });
    const origin = await reauthenticated(stayer);
    const res = await http()
      .post(`/api/v1/account/profiles/${mover.profileId ?? ''}/transfer`)
      .set(origin.mutation)
      .send({ kind: 'DETACH', regroup: true, email: 'z@lahotte.test' })
      .expect(422);
    expect(res.body.code).toBe('LAST_PROFILE');
  });

  it('M3 : sans adresse saisie ni adresse du profil, le détachement est refusé', async () => {
    const stayer = await account('Parent');
    const mover = await addProfile(stayer, { displayName: 'Majeur' });
    const origin = await reauthenticated(stayer);
    const res = await http()
      .post(`/api/v1/account/profiles/${mover.profileId ?? ''}/transfer`)
      .set(origin.mutation)
      .send({ kind: 'DETACH' })
      .expect(422);
    expect(res.body.code).toBe('DETACH_EMAIL_REQUIRED');
  });
});

describe('revue SEC-40 du code (cycle 2)', () => {
  it('I1 : l’espace Compte ne lit pas l’adresse du profil prise par défaut ; le profil, si', async () => {
    const stayer = await account('Parent');
    const mover = await addProfile(stayer, { displayName: 'Majeur' });
    const email = `perso-${randomUUID()}@lahotte.test`;
    const profile = identity.accounts.profiles.get(mover.profileId ?? '');
    if (profile) {
      profile.email = email;
      profile.emailVerifiedAt = new Date(Date.now() - 10 * DAY);
    }
    const origin = await reauthenticated(stayer);
    await http()
      .post(`/api/v1/account/profiles/${mover.profileId ?? ''}/transfer`)
      .set(origin.mutation)
      .send({ kind: 'DETACH' })
      .expect(201);
    const asAccount = await http()
      .get(`/api/v1/account/profiles/${mover.profileId ?? ''}/transfer`)
      .set({ Cookie: origin.cookie })
      .expect(200);
    expect(asAccount.body.newEmail).toBeNull();
    expect(JSON.stringify(asAccount.body)).not.toContain(email);
    const asProfile = await http()
      .get('/api/v1/profiles/me/transfer')
      .set({ Cookie: mover.cookie });
    expect(asProfile.body.transfer.newEmail).toBe(email);
  });

  it('I2 : des jetons faux ne bloquent pas un lien d’annulation valable', async () => {
    const { mover, host, origin } = await families();
    const email = `part-${randomUUID()}@lahotte.test`;
    const profile = identity.accounts.profiles.get(mover.profileId ?? '');
    if (profile) {
      profile.email = email;
      profile.emailVerifiedAt = new Date(Date.now() - 10 * DAY);
    }
    const requested = await requestMove(origin, mover.profileId ?? '').expect(201);
    await http()
      .post('/api/v1/profiles/me/transfer/consent')
      .set(mover.mutation)
      .send({ pinChoice: 'NONE' })
      .expect(204);
    const hostFresh = await reauthenticated(host);
    await http()
      .post('/api/v1/account/transfers/accept')
      .set(hostFresh.mutation)
      .send({ token: requested.body.token })
      .expect(204);
    await identity.background.flush();
    const token = identity.mail.lastToken(email);
    const anonymous = await presession();
    let limited = false;
    for (let i = 0; i < 40 && !limited; i += 1) {
      const res = await http()
        .post('/api/v1/transfers/cancel')
        .set(anonymous)
        .send({ token: 'A'.repeat(43) });
      limited = res.status === 429;
    }
    expect(limited).toBe(true);
    await http().post('/api/v1/transfers/cancel').set(anonymous).send({ token }).expect(204);
  });
});
