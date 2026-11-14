import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PurgeUnverifiedAccounts } from '../../src/modules/identity/application/contract';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { PRESESSION_COOKIE } from '../../src/modules/identity/presentation/cookies';
import { session, signIn, type SignedIn, WEB_ORIGIN } from '../support/sign-in';
import { createTestApp, type TestIdentity } from './create-test-app';

// Liens, cercle, invitations, blocage (LNK-01 à LNK-10, PRO-05, PRO-09, AUTH-09).

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
  identity.google.enabled = true;
  identity.links.links.clear();
  identity.links.invitations.clear();
  identity.links.blocks.length = 0;
});

const http = () => request(app.getHttpServer());
const PASSWORD = 'une phrase de passe assez longue';
const DAY = 24 * 60 * 60 * 1000;

/** Compte vérifié (base mémoire) avec un profil actif ; `isChild` : profil enfant (PRO-05). */
async function person(options: { isChild?: boolean; displayName?: string } = {}) {
  const user = await identity.signIn(options);
  identity.accounts.seed({ id: user.accountId, email: `l-${user.accountId}@lahotte.test` });
  return user;
}

/** Profil non enfant du compte d'un enfant, avec sa propre session : son tuteur (LNK-06). */
async function guardianOf(kid: SignedIn, displayName = 'Parent'): Promise<SignedIn> {
  const profileId = randomUUID();
  identity.profiles.set({
    profileId,
    accountId: kid.accountId,
    hasPin: false,
    relock: 'IDLE_15',
  });
  const profile = identity.accounts.profiles.get(profileId);
  if (profile) identity.accounts.profiles.set(profileId, { ...profile, displayName });
  return signIn(app, { accountId: kid.accountId, profileId });
}

async function invite(user: SignedIn, body: Record<string, unknown> = {}): Promise<string> {
  const res = await http().post('/api/v1/invitations').set(user.mutation).send(body).expect(201);
  return res.body.token as string;
}

function redeem(user: SignedIn, token: string): request.Test {
  return http().post('/api/v1/invitations/redeem').set(user.mutation).send({ token });
}

async function circleOf(user: SignedIn): Promise<string[]> {
  const res = await http().get('/api/v1/circle').set({ Cookie: user.cookie }).expect(200);
  return (res.body.items as { profileId: string }[]).map((member) => member.profileId);
}

/** Deux profils de comptes différents, liés par une invitation ouverte. */
async function linkedPair() {
  const a = await person({ displayName: 'Alice' });
  const b = await person({ displayName: 'Bruno' });
  const res = await redeem(b, await invite(a)).expect(201);
  return { a, b, linkId: res.body.linkId as string };
}

describe('POST /invitations (LNK-01)', () => {
  it('rend un jeton de 128 bits une seule fois ; la liste ne le montre jamais', async () => {
    const a = await person();
    const res = await http().post('/api/v1/invitations').set(a.mutation).send({}).expect(201);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const list = await http().get('/api/v1/invitations').set({ Cookie: a.cookie }).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(res.body.token as string);
    // Seul le hash est conservé.
    const stored = [...identity.links.invitations.values()];
    expect(stored.map((i) => i.tokenHash)).not.toContain(res.body.token);
  });

  it('par e-mail : le lien part avec le jeton dans le fragment et le nom de l’invitant', async () => {
    const a = await person({ displayName: 'Alice' });
    const address = `invite-${randomUUID()}@lahotte.test`;
    const token = await invite(a, { email: address });
    await identity.background.flush();
    const mail = identity.mail.sent.find((m) => m.to === address);
    expect(mail?.text).toContain('Alice');
    expect(mail?.text).toContain(`#${token}`);
    expect(identity.mail.lastToken(address)).toBe(token);
  });

  it('un profil enfant n’invite pas par e-mail (PRO-05)', async () => {
    const kid = await person({ isChild: true });
    const res = await http()
      .post('/api/v1/invitations')
      .set(kid.mutation)
      .send({ email: `kid-${randomUUID()}@lahotte.test` })
      .expect(403);
    expect(res.body.code).toBe('CHILD_EMAIL_FORBIDDEN');
    // Sans adresse, un enfant peut partager un lien.
    await http().post('/api/v1/invitations').set(kid.mutation).send({}).expect(201);
  });

  it('20 invitations ouvertes au plus par profil, puis 422', async () => {
    const a = await person();
    for (let i = 0; i < 20; i += 1) await invite(a);
    // Le plafond de création (20 par 24 h) répond d'abord 429 ; une fois remis à zéro, c'est le
    // plafond des invitations ouvertes.
    await http().post('/api/v1/invitations').set(a.mutation).send({}).expect(429);
    identity.rateLimiter.reset();
    const res = await http().post('/api/v1/invitations').set(a.mutation).send({}).expect(422);
    expect(res.body.code).toBe('INVITATION_LIMIT_REACHED');
  });

  it('refuse un corps avec un champ inconnu et une adresse invalide', async () => {
    const a = await person();
    await http().post('/api/v1/invitations').set(a.mutation).send({ extra: 1 }).expect(400);
    await http().post('/api/v1/invitations').set(a.mutation).send({ email: 'x' }).expect(400);
  });

  it('sans session : 401', async () => {
    await http().post('/api/v1/invitations').send({}).expect(401);
    await http().get('/api/v1/circle').expect(401);
  });
});

describe('DELETE /invitations/{id} (LNK-01)', () => {
  it('révoque ; le jeton ne s’ouvre plus (refus commun) ; l’invitation d’un autre profil est introuvable', async () => {
    const a = await person();
    const b = await person();
    const token = await invite(a);
    const [row] = await http()
      .get('/api/v1/invitations')
      .set({ Cookie: a.cookie })
      .expect(200)
      .then((res) => res.body.items as { id: string }[]);
    await http()
      .delete(`/api/v1/invitations/${row?.id ?? ''}`)
      .set(b.mutation)
      .expect(404);
    await http()
      .delete(`/api/v1/invitations/${row?.id ?? ''}`)
      .set(a.mutation)
      .expect(204);
    const refused = await redeem(b, token).expect(404);
    expect(refused.body.code).toBe('INVITATION_INVALID');
  });
});

describe('POST /invitations/redeem (LNK-02, LNK-06, LNK-07)', () => {
  it('accepté d’office : chacun est dans le cercle de l’autre', async () => {
    const { a, b, linkId } = await linkedPair();
    expect(linkId).toBeTruthy();
    expect(await circleOf(a)).toContain(b.profileId);
    expect(await circleOf(b)).toContain(a.profileId);
    const links = await http().get('/api/v1/links').set({ Cookie: b.cookie }).expect(200);
    expect(links.body.items[0]).toMatchObject({
      status: 'ACCEPTED',
      role: 'PARTY',
      counterpart: { profileId: a.profileId, displayName: 'Alice' },
    });
  });

  it('le jeton rejoué, inconnu, expiré ou révoqué reçoit le même refus', async () => {
    const a = await person();
    const b = await person();
    const c = await person();
    const token = await invite(a);
    await redeem(b, token).expect(201);

    const replayed = await redeem(c, token).expect(404);
    const unknown = await redeem(c, 'A'.repeat(22)).expect(404);
    const expiredToken = await invite(a);
    const latest = [...identity.links.invitations.values()].at(-1);
    if (latest) latest.expiresAt = new Date(Date.now() - DAY);
    const expired = await redeem(c, expiredToken).expect(404);
    for (const body of [replayed.body, unknown.body, expired.body]) {
      expect(body.code).toBe('INVITATION_INVALID');
      expect(body.detail).toBe(replayed.body.detail);
    }
  });

  it('jeton mal formé : 400, sans écho du jeton', async () => {
    const a = await person();
    const res = await redeem(a, 'MARQUEUR_trop_court').expect(400);
    expect(JSON.stringify(res.body)).not.toContain('MARQUEUR_trop_court');
  });

  it('même compte : 422 LINK_SAME_ACCOUNT, sans consommer l’invitation (LNK-03)', async () => {
    const a = await person();
    const token = await invite(a);
    const res = await redeem(a, token).expect(422);
    expect(res.body.code).toBe('LINK_SAME_ACCOUNT');
    const b = await person();
    await redeem(b, token).expect(201);
  });

  it('lien déjà existant : 409 sans consommer l’invitation', async () => {
    const { a, b } = await linkedPair();
    const token = await invite(a);
    const res = await redeem(b, token).expect(409);
    expect(res.body.code).toBe('ALREADY_LINKED');
    const c = await person();
    await redeem(c, token).expect(201);
  });

  it('ouvertures simultanées du même jeton : un seul lien', async () => {
    const a = await person();
    const token = await invite(a);
    const guests = await Promise.all([person(), person(), person()]);
    const results = await Promise.all(guests.map((guest) => redeem(guest, token)));
    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    expect(identity.links.links.size).toBe(1);
  });

  it('inspect : nom de l’invitant ; absent pour un enfant ; refus commun sinon (LNK-07)', async () => {
    const a = await person({ displayName: 'Alice' });
    const kid = await person({ isChild: true, displayName: 'Léa' });
    const b = await person();
    const seen = await http()
      .post('/api/v1/invitations/inspect')
      .set(b.mutation)
      .send({ token: await invite(a) })
      .expect(200);
    expect(seen.body.inviterName).toBe('Alice');
    const hidden = await http()
      .post('/api/v1/invitations/inspect')
      .set(b.mutation)
      .send({ token: await invite(kid) })
      .expect(200);
    expect(hidden.body.inviterName).toBeNull();
    expect(JSON.stringify(hidden.body)).not.toContain('Léa');
    await http()
      .post('/api/v1/invitations/inspect')
      .set(b.mutation)
      .send({ token: 'B'.repeat(22) })
      .expect(404);
  });
});

describe('DELETE /links/{id} (LNK-02)', () => {
  it('rupture : les accès sont retirés à la requête suivante, des deux côtés', async () => {
    const { a, b, linkId } = await linkedPair();
    await http().delete(`/api/v1/links/${linkId}`).set(b.mutation).expect(204);
    expect(await circleOf(a)).not.toContain(b.profileId);
    expect(await circleOf(b)).not.toContain(a.profileId);
    expect(await identity.links.inCircle(a.profileId ?? '', b.profileId ?? '')).toBe(false);
  });

  it('un tiers ne rompt pas un lien : 404', async () => {
    const { linkId } = await linkedPair();
    const stranger = await person();
    await http().delete(`/api/v1/links/${linkId}`).set(stranger.mutation).expect(404);
    await http().delete(`/api/v1/links/${randomUUID()}`).set(stranger.mutation).expect(404);
  });
});

describe('blocage (LNK-05)', () => {
  it('bloquer supprime le lien ; aucune des deux parties ne peut plus ouvrir l’invitation de l’autre', async () => {
    const { a, b } = await linkedPair();
    await http()
      .post('/api/v1/blocks')
      .set(b.mutation)
      .send({ profileId: a.profileId })
      .expect(204);
    expect(await circleOf(a)).not.toContain(b.profileId);
    expect(await circleOf(b)).not.toContain(a.profileId);
    expect(await identity.links.isBlockedEitherWay(a.profileId ?? '', b.profileId ?? '')).toBe(
      true,
    );
    const fromA = await redeem(b, await invite(a)).expect(404);
    const fromB = await redeem(a, await invite(b)).expect(404);
    expect(fromA.body.code).toBe('INVITATION_INVALID');
    expect(fromB.body.code).toBe('INVITATION_INVALID');
    // Le refus ne distingue pas un blocage d'un jeton inconnu.
    const unknown = await redeem(b, 'C'.repeat(22)).expect(404);
    expect({ ...fromA.body, requestId: 0 }).toEqual({ ...unknown.body, requestId: 0 });
    const blocked = await http().get('/api/v1/blocks').set({ Cookie: b.cookie }).expect(200);
    expect(blocked.body.items).toEqual([
      expect.objectContaining({ profileId: a.profileId, displayName: 'Alice' }),
    ]);
  });

  it('lever le blocage ne rétablit pas le lien, mais permet une nouvelle invitation', async () => {
    const { a, b } = await linkedPair();
    await http()
      .post('/api/v1/blocks')
      .set(b.mutation)
      .send({ profileId: a.profileId })
      .expect(204);
    await http().delete(`/api/v1/blocks/${a.profileId}`).set(b.mutation).expect(204);
    expect(await circleOf(a)).not.toContain(b.profileId);
    await redeem(b, await invite(a)).expect(201);
    expect(await circleOf(a)).toContain(b.profileId);
    await http().delete(`/api/v1/blocks/${a.profileId}`).set(b.mutation).expect(404);
  });

  it('ne vise qu’une contrepartie d’un lien : 404 sinon, 422 pour soi ou son compte', async () => {
    const a = await person();
    const stranger = await person();
    await http()
      .post('/api/v1/blocks')
      .set(a.mutation)
      .send({ profileId: stranger.profileId })
      .expect(404);
    await http()
      .post('/api/v1/blocks')
      .set(a.mutation)
      .send({ profileId: randomUUID() })
      .expect(404);
    const self = await http()
      .post('/api/v1/blocks')
      .set(a.mutation)
      .send({ profileId: a.profileId })
      .expect(422);
    expect(self.body.code).toBe('BLOCK_SELF');
    const sibling = randomUUID();
    identity.profiles.set({
      profileId: sibling,
      accountId: a.accountId,
      hasPin: false,
      relock: 'IDLE_15',
    });
    const same = await http()
      .post('/api/v1/blocks')
      .set(a.mutation)
      .send({ profileId: sibling })
      .expect(422);
    expect(same.body.code).toBe('LINK_SAME_ACCOUNT');
  });

  it('le nom d’un enfant bloqué n’apparaît pas dans la liste (PRO-05)', async () => {
    const a = await person();
    const kid = await person({ isChild: true, displayName: 'Léa' });
    const linked = await redeem(a, await invite(kid)).expect(201);
    expect(linked.body.status).toBe('AWAITING_GUARDIAN');
    await http()
      .post('/api/v1/blocks')
      .set(a.mutation)
      .send({ profileId: kid.profileId })
      .expect(204);
    const res = await http().get('/api/v1/blocks').set({ Cookie: a.cookie }).expect(200);
    expect(res.body.items).toEqual([expect.objectContaining({ displayName: null })]);
    expect(JSON.stringify(res.body)).not.toContain('Léa');
  });
});

describe('profil enfant : validation parentale (PRO-05, LNK-06)', () => {
  it('le lien attend un tuteur, et le nom de l’enfant n’est pas rendu avant', async () => {
    const friend = await person({ displayName: 'Zoé' });
    const kid = await person({ isChild: true, displayName: 'Léa' });
    const guardian = await guardianOf(kid, 'Paul');
    const created = await redeem(friend, await invite(kid)).expect(201);
    expect(created.body.status).toBe('AWAITING_GUARDIAN');
    const linkId = created.body.linkId as string;

    expect(await circleOf(friend)).not.toContain(kid.profileId);
    expect(await circleOf(kid)).not.toContain(friend.profileId);
    const seen = await http().get('/api/v1/links').set({ Cookie: friend.cookie }).expect(200);
    expect(seen.body.items[0].counterpart.displayName).toBeNull();
    expect(JSON.stringify(seen.body)).not.toContain('Léa');

    const guarded = await http().get('/api/v1/links').set({ Cookie: guardian.cookie }).expect(200);
    expect(guarded.body.items[0]).toMatchObject({
      role: 'GUARDIAN',
      awaitingMyApproval: true,
      child: { displayName: 'Léa' },
    });

    // Ni l'autre partie, ni l'enfant lui-même, ni un tiers ne valident.
    for (const outsider of [friend, kid, await person()]) {
      await http().post(`/api/v1/links/${linkId}/approve`).set(outsider.mutation).expect(404);
    }
    await http().post(`/api/v1/links/${linkId}/approve`).set(guardian.mutation).expect(204);
    expect(await circleOf(friend)).toContain(kid.profileId);
    const accepted = await http().get('/api/v1/links').set({ Cookie: friend.cookie }).expect(200);
    expect(accepted.body.items[0]).toMatchObject({
      status: 'ACCEPTED',
      counterpart: { displayName: 'Léa' },
    });
    // Une seconde validation du même côté : introuvable.
    await http().post(`/api/v1/links/${linkId}/approve`).set(guardian.mutation).expect(404);
  });

  it('deux enfants : le lien n’est accepté qu’après les deux validations', async () => {
    const kidA = await person({ isChild: true, displayName: 'Léa' });
    const kidB = await person({ isChild: true, displayName: 'Tom' });
    const guardianA = await guardianOf(kidA);
    const guardianB = await guardianOf(kidB);
    const created = await redeem(kidB, await invite(kidA)).expect(201);
    const linkId = created.body.linkId as string;
    await http().post(`/api/v1/links/${linkId}/approve`).set(guardianA.mutation).expect(204);
    expect(await circleOf(kidA)).not.toContain(kidB.profileId);
    await http().post(`/api/v1/links/${linkId}/approve`).set(guardianB.mutation).expect(204);
    expect(await circleOf(kidA)).toContain(kidB.profileId);
    expect(await circleOf(kidB)).toContain(kidA.profileId);
  });

  it('le tuteur rompt le lien en attente de son enfant', async () => {
    const friend = await person();
    const kid = await person({ isChild: true });
    const guardian = await guardianOf(kid);
    const created = await redeem(friend, await invite(kid)).expect(201);
    await http()
      .delete(`/api/v1/links/${created.body.linkId as string}`)
      .set(guardian.mutation)
      .expect(204);
    expect(identity.links.links.size).toBe(0);
  });
});

describe('PUT /account/profiles/{id}/child (PRO-09)', () => {
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

  it('exige une ré-authentification récente', async () => {
    const a = await person();
    const res = await http()
      .put(`/api/v1/account/profiles/${a.profileId}/child`)
      .set(a.mutation)
      .send({ isChild: true })
      .expect(401);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
  });

  it('change le marqueur dans les deux sens, journalisé ; profil d’un autre compte : 404', async () => {
    const a = await person();
    const fresh = await reauthenticated(a);
    await http()
      .put(`/api/v1/account/profiles/${a.profileId}/child`)
      .set(fresh.mutation)
      .send({ isChild: true })
      .expect(204);
    const listed = await http()
      .get('/api/v1/account/profiles')
      .set({ Cookie: fresh.cookie })
      .expect(200);
    expect(listed.body.items[0].isChild).toBe(true);
    await http()
      .put(`/api/v1/account/profiles/${a.profileId}/child`)
      .set(fresh.mutation)
      .send({ isChild: false })
      .expect(204);
    expect(
      identity.securityLog.entries.filter((e) => e.event === 'profile.child_changed'),
    ).toHaveLength(2);
    const other = await person();
    await http()
      .put(`/api/v1/account/profiles/${other.profileId}/child`)
      .set(fresh.mutation)
      .send({ isChild: true })
      .expect(404);
    await http()
      .put(`/api/v1/account/profiles/${a.profileId}/child`)
      .set(fresh.mutation)
      .send({ isChild: 'oui' })
      .expect(400);
  });
});

describe('inscription par invitation (AUTH-09, LNK-08)', () => {
  async function presession(): Promise<Record<string, string>> {
    const res = await http().get('/api/v1/session').expect(200);
    const raw = res.headers['set-cookie'] as unknown;
    const cookies = Array.isArray(raw) ? (raw as string[]) : [];
    const id = decodeURIComponent(
      cookies
        .find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))
        ?.split(';')[0]
        ?.slice(PRESESSION_COOKIE.length + 1) ?? '',
    );
    return {
      Cookie: `${PRESESSION_COOKIE}=${id}`,
      'X-CSRF-Token': res.body.csrfToken as string,
      Origin: WEB_ORIGIN,
    };
  }

  async function signUp(address: string, invitationToken?: string): Promise<request.Response> {
    return http()
      .post('/api/v1/auth/register')
      .set(await presession())
      .send({
        email: address,
        password: PASSWORD,
        displayName: 'Nouvelle',
        ageAttested: true,
        ...(invitationToken ? { invitationToken } : {}),
      });
  }

  async function verify(address: string): Promise<request.Response> {
    await identity.background.flush();
    const token = identity.mail.lastToken(address);
    return http()
      .post('/api/v1/auth/email/verify')
      .set(await presession())
      .send({ token });
  }

  it('INVITE_ONLY : sans jeton ou avec un jeton invalide, 403 INVITATION_REQUIRED', async () => {
    identity.settings.registrationMode = 'INVITE_ONLY';
    const address = `n-${randomUUID()}@lahotte.test`;
    const without = await signUp(address).then((res) => res);
    expect(without.status).toBe(403);
    expect(without.body.code).toBe('INVITATION_REQUIRED');
    const invalid = await signUp(address, 'D'.repeat(22));
    expect(invalid.body.code).toBe('INVITATION_REQUIRED');
    expect(await identity.accounts.findByEmail(address)).toBeNull();
  });

  it('INVITE_ONLY : avec un jeton valide, le lien naît à la vérification de l’e-mail', async () => {
    identity.settings.registrationMode = 'INVITE_ONLY';
    const inviter = await person({ displayName: 'Alice' });
    const token = await invite(inviter);
    const address = `n-${randomUUID()}@lahotte.test`;
    expect((await signUp(address, token)).status).toBe(202);
    await identity.background.flush();
    // Avant la vérification, rien n'est consommé et aucun lien n'existe.
    expect(identity.links.links.size).toBe(0);
    expect((await verify(address)).status).toBe(204);
    const circle = await http().get('/api/v1/circle').set({ Cookie: inviter.cookie }).expect(200);
    expect(circle.body.items).toEqual([expect.objectContaining({ displayName: 'Nouvelle' })]);
    const account = await identity.accounts.findByEmail(address);
    expect(account?.emailVerified).toBe(true);
    // Le jeton est consommé : il ne sert plus à une seconde inscription.
    const again = await signUp(`n-${randomUUID()}@lahotte.test`, token);
    expect(again.body.code).toBe('INVITATION_REQUIRED');
  });

  it('INVITE_ONLY : invitation épuisée avant la vérification, compte supprimé et refus neutre', async () => {
    identity.settings.registrationMode = 'INVITE_ONLY';
    const inviter = await person();
    const token = await invite(inviter);
    const address = `n-${randomUUID()}@lahotte.test`;
    expect((await signUp(address, token)).status).toBe(202);
    await identity.background.flush();
    await redeem(await person(), token).expect(201);
    const res = await verify(address);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).not.toMatch(/invitation/i);
    expect(await identity.accounts.findByEmail(address)).toBeNull();
  });

  it('OPEN : un jeton invalide est ignoré ; une invitation épuisée ne bloque pas la vérification', async () => {
    const inviter = await person();
    const token = await invite(inviter);
    const first = `n-${randomUUID()}@lahotte.test`;
    expect((await signUp(first, 'E'.repeat(22))).status).toBe(202);
    expect((await verify(first)).status).toBe(204);
    expect(identity.links.links.size).toBe(0);

    const second = `n-${randomUUID()}@lahotte.test`;
    expect((await signUp(second, token)).status).toBe(202);
    await identity.background.flush();
    await redeem(await person(), token).expect(201);
    expect((await verify(second)).status).toBe(204);
    expect((await identity.accounts.findByEmail(second))?.emailVerified).toBe(true);
  });

  it('INVITE_ONLY, Google : le jeton voyage dans le parcours et le lien est créé à l’inscription', async () => {
    identity.settings.registrationMode = 'INVITE_ONLY';
    const inviter = await person({ displayName: 'Alice' });
    const token = await invite(inviter);
    const pre = await presession();
    const start = await http()
      .post('/api/v1/auth/google/start')
      .set(pre)
      .send({ registration: { displayName: 'Camille', ageAttested: true, invitationToken: token } })
      .expect(200);
    const subject = `sub${randomUUID().replaceAll('-', '')}`;
    const query = identity.google.approve(start.body.authorizationUrl as string, { subject });
    const res = await http()
      .get(`/api/v1/auth/google/callback?${query}`)
      .set('Cookie', pre.Cookie ?? '');
    expect(new URL(res.headers.location as string).searchParams.get('status')).toBe('signed_in');
    const circle = await http().get('/api/v1/circle').set({ Cookie: inviter.cookie }).expect(200);
    expect(circle.body.items).toEqual([expect.objectContaining({ displayName: 'Camille' })]);
  });

  it('INVITE_ONLY, Google : sans jeton, INVITATION_REQUIRED', async () => {
    identity.settings.registrationMode = 'INVITE_ONLY';
    const pre = await presession();
    const start = await http()
      .post('/api/v1/auth/google/start')
      .set(pre)
      .send({ registration: { displayName: 'Camille', ageAttested: true } })
      .expect(200);
    const query = identity.google.approve(start.body.authorizationUrl as string, {
      subject: `sub${randomUUID().replaceAll('-', '')}`,
    });
    const res = await http()
      .get(`/api/v1/auth/google/callback?${query}`)
      .set('Cookie', pre.Cookie ?? '');
    expect(new URL(res.headers.location as string).searchParams.get('error')).toBe(
      'INVITATION_REQUIRED',
    );
  });
});

describe('cercle et recherche (LNK-04, LNK-09)', () => {
  it('le cercle comprend les autres profils du compte, sans doublon', async () => {
    const a = await person({ displayName: 'Alice' });
    const sibling = randomUUID();
    identity.profiles.set({
      profileId: sibling,
      accountId: a.accountId,
      hasPin: false,
      relock: 'IDLE_15',
    });
    const res = await http().get('/api/v1/circle').set({ Cookie: a.cookie }).expect(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({ profileId: sibling, source: 'ACCOUNT' }),
    ]);
  });

  it('aucune route ne cherche un profil hors du cercle (LNK-04)', async () => {
    const a = await person();
    for (const path of [
      '/api/v1/profiles?q=alice',
      '/api/v1/profiles/search?q=a',
      '/api/v1/users',
    ]) {
      await http().get(path).set({ Cookie: a.cookie }).expect(404);
    }
  });
});

describe('purge des invitations (LNK-10, RGPD-09)', () => {
  it('supprime celles terminées depuis plus de 30 jours, garde les récentes', async () => {
    const a = await person();
    await invite(a);
    await invite(a);
    const [old, recent] = [...identity.links.invitations.values()];
    if (!old || !recent) throw new Error('Invitations absentes');
    old.expiresAt = new Date(Date.now() - 31 * DAY);
    recent.expiresAt = new Date(Date.now() - DAY);
    await app.get(PurgeUnverifiedAccounts).execute();
    expect(identity.links.invitations.has(old.id)).toBe(false);
    expect(identity.links.invitations.has(recent.id)).toBe(true);
  });
});

describe('revue SEC-40, cycle 1', () => {
  it('B1 : la réinitialisation ne vérifie pas un compte qui attend une invitation', async () => {
    identity.settings.registrationMode = 'INVITE_ONLY';
    const inviter = await person();
    const token = await invite(inviter);
    const address = `n-${randomUUID()}@lahotte.test`;
    const pre = async () => {
      const res = await http().get('/api/v1/session').expect(200);
      const raw = res.headers['set-cookie'] as unknown;
      const cookie = (Array.isArray(raw) ? (raw as string[]) : []).find((c) =>
        c.startsWith(`${PRESESSION_COOKIE}=`),
      );
      return {
        Cookie: (cookie ?? '').split(';')[0] ?? '',
        'X-CSRF-Token': res.body.csrfToken as string,
        Origin: WEB_ORIGIN,
      };
    };
    await http()
      .post('/api/v1/auth/register')
      .set(await pre())
      .send({
        email: address,
        password: PASSWORD,
        displayName: 'Nouvelle',
        ageAttested: true,
        invitationToken: token,
      })
      .expect(202);
    await identity.background.flush();
    await http()
      .post('/api/v1/auth/password/reset')
      .set(await pre())
      .send({ email: address })
      .expect(202);
    await identity.background.flush();
    const resetToken = identity.mail.sent.filter((m) => m.to === address).at(-1)?.text;
    const raw = /#([A-Za-z0-9_-]+)/.exec(resetToken ?? '')?.[1];
    await http()
      .post('/api/v1/auth/password/reset/confirm')
      .set(await pre())
      .send({ token: raw, newPassword: `${PASSWORD} bis` })
      .expect(204);
    expect((await identity.accounts.findByEmail(address))?.emailVerified).toBe(false);
    expect(identity.links.links.size).toBe(0);
  });

  it('I1 : le tuteur d’un enfant ne lit pas le nom de l’enfant d’en face après acceptation', async () => {
    const kidA = await person({ isChild: true, displayName: 'Léa' });
    const kidB = await person({ isChild: true, displayName: 'Tom' });
    const guardianA = await guardianOf(kidA);
    const guardianB = await guardianOf(kidB);
    const created = await redeem(kidB, await invite(kidA)).expect(201);
    const linkId = created.body.linkId as string;
    await http().post(`/api/v1/links/${linkId}/approve`).set(guardianA.mutation).expect(204);
    await http().post(`/api/v1/links/${linkId}/approve`).set(guardianB.mutation).expect(204);
    const res = await http().get('/api/v1/links').set({ Cookie: guardianA.cookie }).expect(200);
    expect(res.body.items[0].counterpart.displayName).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('Tom');
  });
});
