import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { PRESESSION_COOKIE } from '../../src/modules/identity/presentation/cookies';
import { session, type SignedIn, WEB_ORIGIN } from '../support/sign-in';
import { createTestApp, type TestIdentity } from './create-test-app';

// Adresse d'un profil et invitation à créer un profil (PRO-10, PRO-11, LNK-01, LNK-05, LNK-07).

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

async function person(
  options: { isChild?: boolean; displayName?: string } = {},
): Promise<SignedIn> {
  const user = await identity.signIn(options);
  identity.accounts.seed({ id: user.accountId, email: `p-${user.accountId}@lahotte.test` });
  return user;
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

/** Deux profils de comptes différents, liés (LNK-06). */
async function linkedPair(): Promise<{ a: SignedIn; b: SignedIn }> {
  const a = await person({ displayName: 'Alice' });
  const b = await person({ displayName: 'Bruno' });
  const invitation = await http().post('/api/v1/invitations').set(a.mutation).send({}).expect(201);
  await http()
    .post('/api/v1/invitations/redeem')
    .set(b.mutation)
    .send({ token: invitation.body.token })
    .expect(201);
  return { a, b };
}

function profilesOf(accountId: string) {
  return [...identity.accounts.profiles.values()].filter((p) => p.accountId === accountId);
}

describe('adresse d’un profil (PRO-10)', () => {
  it('écrite seulement à la vérification, rendue au seul profil, signalée à l’espace Compte', async () => {
    const user = await person();
    const email = `moi-${user.accountId}@lahotte.test`;
    await http()
      .put('/api/v1/profiles/me/email')
      .set(user.mutation)
      .send({ email: email.toUpperCase() })
      .expect(204);
    await identity.background.flush();
    const before = await http().get('/api/v1/profiles/me').set({ Cookie: user.cookie }).expect(200);
    expect(before.body.email).toBeNull();
    const token = identity.mail.lastToken(email);
    expect(identity.mail.sent.at(-1)?.text).toContain('/profiles/verify-email#');

    await http()
      .post('/api/v1/profiles/email/verify')
      .set(await presession())
      .send({ token })
      .expect(204);
    const after = await http().get('/api/v1/profiles/me').set({ Cookie: user.cookie }).expect(200);
    expect(after.body.email).toBe(email);
    const listed = await http()
      .get('/api/v1/account/profiles')
      .set({ Cookie: user.cookie })
      .expect(200);
    expect(listed.body.items[0]).toMatchObject({ hasEmail: true });
    expect(JSON.stringify(listed.body)).not.toContain(email);

    const replay = await http()
      .post('/api/v1/profiles/email/verify')
      .set(await presession())
      .send({ token })
      .expect(422);
    expect(replay.body.code).toBe('TOKEN_INVALID');

    await http().delete('/api/v1/profiles/me/email').set(user.mutation).expect(204);
    const cleared = await http()
      .get('/api/v1/profiles/me')
      .set({ Cookie: user.cookie })
      .expect(200);
    expect(cleared.body.email).toBeNull();
  });

  it('refusée à un profil enfant (RGPD-02)', async () => {
    const kid = await person({ isChild: true });
    const res = await http()
      .put('/api/v1/profiles/me/email')
      .set(kid.mutation)
      .send({ email: `kid-${kid.accountId}@lahotte.test` })
      .expect(403);
    expect(res.body.code).toBe('CHILD_EMAIL_FORBIDDEN');
  });

  it('une nouvelle demande désarme le lien précédent', async () => {
    const user = await person();
    const first = `un-${user.accountId}@lahotte.test`;
    const second = `deux-${user.accountId}@lahotte.test`;
    await http().put('/api/v1/profiles/me/email').set(user.mutation).send({ email: first });
    await http().put('/api/v1/profiles/me/email').set(user.mutation).send({ email: second });
    await identity.background.flush();
    await http()
      .post('/api/v1/profiles/email/verify')
      .set(await presession())
      .send({ token: identity.mail.lastToken(first) })
      .expect(422);
  });
});

describe('invitation à créer un profil dans son compte (PRO-11)', () => {
  it('ouverte sans session, elle crée le profil avec son PIN, sans ouvrir de session', async () => {
    const inviter = await person({ displayName: 'Alice' });
    const created = await http()
      .post('/api/v1/invitations')
      .set(inviter.mutation)
      .send({ kind: 'PROFILE' })
      .expect(201);
    const listed = await http()
      .get('/api/v1/invitations')
      .set({ Cookie: inviter.cookie })
      .expect(200);
    expect(listed.body.items[0]).toMatchObject({ kind: 'PROFILE', proposal: 'ACCEPTED' });

    const preview = await http()
      .post('/api/v1/invitations/profile/inspect')
      .set(await presession())
      .send({ token: created.body.token })
      .expect(200);
    expect(preview.body).toMatchObject({ inviterName: 'Alice', profileIsChild: false });

    const accepted = await http()
      .post('/api/v1/invitations/profile/accept')
      .set(await presession())
      .send({ token: created.body.token, displayName: 'Mamie', pin: '2468' })
      .expect(204);
    expect(accepted.headers['set-cookie'] ?? []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('__Host-lh_session')]),
    );
    const mamie = profilesOf(inviter.accountId).find((p) => p.displayName === 'Mamie');
    expect(mamie?.pinHash).toBeTruthy();
    expect(identity.links.linksOf(mamie?.id ?? '')).toEqual([]);

    const replay = await http()
      .post('/api/v1/invitations/profile/accept')
      .set(await presession())
      .send({ token: created.body.token, displayName: 'Mamie' })
      .expect(404);
    expect(replay.body.code).toBe('INVITATION_INVALID');
  });

  it('un profil enfant n’invite pas à créer un profil', async () => {
    const kid = await person({ isChild: true });
    const res = await http()
      .post('/api/v1/invitations')
      .set(kid.mutation)
      .send({ kind: 'PROFILE' })
      .expect(403);
    expect(res.body.code).toBe('PROFILE_INVITATION_FORBIDDEN');
  });

  it('un profil créé enfant n’a pas d’adresse, et garde son accord 30 jours (PRO-12)', async () => {
    const inviter = await person();
    const created = await http()
      .post('/api/v1/invitations')
      .set(inviter.mutation)
      .send({ kind: 'PROFILE', profileIsChild: true })
      .expect(201);
    const refused = await http()
      .post('/api/v1/invitations/profile/accept')
      .set(await presession())
      .send({ token: created.body.token, displayName: 'Léa', email: 'lea@lahotte.test' })
      .expect(403);
    expect(refused.body.code).toBe('CHILD_EMAIL_FORBIDDEN');
    await http()
      .post('/api/v1/invitations/profile/accept')
      .set(await presession())
      .send({ token: created.body.token, displayName: 'Léa' })
      .expect(204);
    const lea = profilesOf(inviter.accountId).find((p) => p.displayName === 'Léa');
    expect(lea?.isChild).toBe(true);
    expect(lea?.childChangedAt).toBeInstanceOf(Date);
  });

  it('les champs de PROFILE ne vont pas avec un lien (400)', async () => {
    const inviter = await person();
    await http()
      .post('/api/v1/invitations')
      .set(inviter.mutation)
      .send({ profileIsChild: true })
      .expect(400);
  });
});

describe('invitation à créer un profil dans le compte d’un profil du cercle (PRO-11)', () => {
  it('le compte visé accepte avec ré-authentification, puis le profil naît lié à l’invitant', async () => {
    const { a, b } = await linkedPair();
    const created = await http()
      .post('/api/v1/invitations')
      .set(a.mutation)
      .send({ kind: 'PROFILE', targetProfileId: b.profileId })
      .expect(201);
    const pending = await http()
      .post('/api/v1/invitations/profile/inspect')
      .set(await presession())
      .send({ token: created.body.token })
      .expect(409);
    expect(pending.body.code).toBe('PROFILE_PROPOSAL_PENDING');

    const proposals = await http()
      .get('/api/v1/account/profile-proposals')
      .set({ Cookie: b.cookie })
      .expect(200);
    const [proposal] = proposals.body.items as Record<string, unknown>[];
    expect(Object.keys(proposal ?? {}).sort()).toEqual(
      ['expiresAt', 'id', 'inviterName', 'profileIsChild'].sort(),
    );
    expect(proposal?.inviterName).toBe('Alice');
    await http()
      .post(`/api/v1/account/profile-proposals/${proposal?.id as string}/accept`)
      .set(b.mutation)
      .expect(401);
    const fresh = await reauthenticated(b);
    await http()
      .post(`/api/v1/account/profile-proposals/${proposal?.id as string}/accept`)
      .set(fresh.mutation)
      .expect(204);

    await http()
      .post('/api/v1/invitations/profile/accept')
      .set(await presession())
      .send({ token: created.body.token, displayName: 'Cousin' })
      .expect(204);
    const cousin = profilesOf(b.accountId).find((p) => p.displayName === 'Cousin');
    expect(cousin).toBeDefined();
    expect(identity.links.linksOf(cousin?.id ?? '')).toEqual([
      expect.objectContaining({ otherId: a.profileId, status: 'ACCEPTED' }),
    ]);
    expect(
      identity.securityLog.entries.filter((e) => e.event === 'profile_invitation.redeemed'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: a.accountId }),
        expect.objectContaining({ accountId: b.accountId }),
      ]),
    );
  });

  it('hors du cercle de l’invitant : refus commun', async () => {
    const inviter = await person();
    const stranger = await person();
    const res = await http()
      .post('/api/v1/invitations')
      .set(inviter.mutation)
      .send({ kind: 'PROFILE', targetProfileId: stranger.profileId })
      .expect(404);
    expect(res.body.code).toBe('INVITATION_TARGET_INVALID');
  });

  it('un refus se voit chez l’invitant, et le jeton ne sert plus', async () => {
    const { a, b } = await linkedPair();
    const created = await http()
      .post('/api/v1/invitations')
      .set(a.mutation)
      .send({ kind: 'PROFILE', targetProfileId: b.profileId })
      .expect(201);
    const proposals = await http()
      .get('/api/v1/account/profile-proposals')
      .set({ Cookie: b.cookie })
      .expect(200);
    await http()
      .delete(`/api/v1/account/profile-proposals/${proposals.body.items[0].id as string}`)
      .set(b.mutation)
      .expect(204);
    const listed = await http().get('/api/v1/invitations').set({ Cookie: a.cookie }).expect(200);
    expect(listed.body.items[0]).toMatchObject({ kind: 'PROFILE', proposal: 'REFUSED' });
    await http()
      .post('/api/v1/invitations/profile/inspect')
      .set(await presession())
      .send({ token: created.body.token })
      .expect(404);
  });

  it('LNK-05 : un blocage après la proposition la révoque, vue comme un refus', async () => {
    const { a, b } = await linkedPair();
    await http()
      .post('/api/v1/invitations')
      .set(a.mutation)
      .send({ kind: 'PROFILE', targetProfileId: b.profileId })
      .expect(201);
    const proposals = await http()
      .get('/api/v1/account/profile-proposals')
      .set({ Cookie: b.cookie })
      .expect(200);
    await http()
      .post('/api/v1/blocks')
      .set(b.mutation)
      .send({ profileId: a.profileId })
      .expect(204);
    const fresh = await reauthenticated(b);
    await http()
      .post(`/api/v1/account/profile-proposals/${proposals.body.items[0].id as string}/accept`)
      .set(fresh.mutation)
      .expect(404);
    const listed = await http().get('/api/v1/invitations').set({ Cookie: a.cookie }).expect(200);
    expect(listed.body.items[0]).toMatchObject({ proposal: 'REFUSED' });
  });
});
