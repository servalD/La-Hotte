import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import {
  BackgroundTasks,
  InMemoryBackgroundTasks,
  InMemoryMailSender,
  MailSender,
  PasswordHasher,
  ProfileRepository,
} from '../../src/modules/identity/testing';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import {
  type IdentityEvent,
  IdentityEvents,
  ProfileLockPolicies,
  SessionStore,
} from '../../src/modules/identity/domain/ports';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, session as sessionHeaders, signIn } from '../support/sign-in';

// Profils et PIN contre PostgreSQL et Redis réels : compteur de PIN-03 en une écriture
// conditionnelle (rafale parallèle), réinitialisation conditionnelle au hash, notice à usage
// unique, nombre de profils sous verrou du compte (PRO-01, PRO-08), sélection de bout en bout.

let app: INestApplication;
let prisma: PrismaService;
let repo: ProfileRepository;
let hasher: PasswordHasher;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailSender)
    .useValue(new InMemoryMailSender())
    .overrideProvider(BackgroundTasks)
    .useValue(new InMemoryBackgroundTasks())
    .compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  repo = app.get(ProfileRepository);
  hasher = app.get(PasswordHasher);
});

afterAll(async () => {
  await app.close();
});

const MINUTE = 60_000;

async function profileWithPin(pin: string): Promise<{ accountId: string; profileId: string }> {
  const created = await createAccountWithProfile(prisma);
  await prisma.profile.update({
    where: { id: created.profileId },
    data: { pinHash: await hasher.hash(pin) },
  });
  return created;
}

function newProfile(displayName: string) {
  const id = randomUUID();
  return {
    id,
    displayName,
    accentColor: '#336699',
    locale: 'fr',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    isChild: false,
  };
}

describe('PIN-03 : compteur en une écriture conditionnelle', () => {
  it('rafale de 12 essais parallèles : 5 comptés, attente d’une minute posée, les autres refusés', async () => {
    const { accountId, profileId } = await profileWithPin('2468');
    const now = new Date();
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () => repo.countPinAttempt(accountId, profileId, now)),
    );
    const counted = attempts.filter((a) => a?.kind === 'counted');
    const locked = attempts.filter((a) => a?.kind === 'locked');
    expect(counted).toHaveLength(5);
    expect(locked).toHaveLength(7);
    const row = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } });
    expect(row.pinFailedCount).toBe(5);
    expect(row.pinLockedUntil?.getTime()).toBe(now.getTime() + MINUTE);
  });

  it('attente écoulée : un essai, attente suivante de 5 minutes ; succès conditionnel au hash', async () => {
    const { accountId, profileId } = await profileWithPin('2468');
    const start = new Date();
    for (let i = 0; i < 5; i += 1) await repo.countPinAttempt(accountId, profileId, start);
    const later = new Date(start.getTime() + MINUTE + 1);
    const sixth = await repo.countPinAttempt(accountId, profileId, later);
    expect(sixth).toMatchObject({ kind: 'counted', failures: 6 });
    expect(await repo.countPinAttempt(accountId, profileId, later)).toMatchObject({
      kind: 'locked',
    });
    const row = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } });
    expect(row.pinLockedUntil?.getTime()).toBe(later.getTime() + 5 * MINUTE);

    if (sixth?.kind !== 'counted') throw new Error('essai non compté');
    // C2-M2 : empreinte calculée par l'adaptateur, la même que lit la garde.
    const policy = await app.get(ProfileLockPolicies).find(accountId, profileId);
    expect(sixth.pinStamp).toBe(policy?.pinStamp);
    expect(await repo.recordPinSuccess(accountId, profileId, 'autre-hash')).toBe(false);
    expect(await repo.recordPinSuccess(accountId, profileId, sixth.pinHash)).toBe(true);
    const reset = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } });
    // PIN-03 : 6 essais comptés, dont celui qui réussit ; restent 5 erreurs depuis l'entrée.
    expect(reset).toMatchObject({
      pinFailedCount: 0,
      pinLockedUntil: null,
      pinFailuresSinceEntry: 5,
    });

    // Revue SEC-40, C2-M1 : un changement de PIN ne les efface pas ; seule l'entrée les prend.
    await repo.setPin({
      accountId,
      profileId,
      pinHash: 'nouveau',
      expectedHash: sixth.pinHash,
      resetNoticeAt: null,
    });
    const taken = await Promise.all([
      repo.takeFailuresSinceEntry(accountId, profileId),
      repo.takeFailuresSinceEntry(accountId, profileId),
    ]);
    expect(taken.sort()).toEqual([0, 5]);
  });

  it('SEC-03 : un profil d’un autre compte n’est ni compté ni lu', async () => {
    const { profileId } = await profileWithPin('2468');
    const other = await createAccountWithProfile(prisma);
    expect(await repo.countPinAttempt(other.accountId, profileId, new Date())).toBeNull();
    const row = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } });
    expect(row.pinFailedCount).toBe(0);
  });
});

describe('PIN-04, PIN-05 : écriture du PIN et notice', () => {
  it('changement conditionnel au hash vérifié ; notice posée par l’espace Compte, effacée par le profil seul', async () => {
    const { accountId, profileId } = await profileWithPin('2468');
    const current = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } });
    expect(
      await repo.setPin({
        accountId,
        profileId,
        pinHash: 'nouveau',
        expectedHash: 'pas-le-bon',
        resetNoticeAt: null,
      }),
    ).toBeNull();
    const written = await repo.setPin({
      accountId,
      profileId,
      pinHash: 'nouveau',
      expectedHash: current.pinHash,
      resetNoticeAt: null,
    });
    expect(written?.pinStamp).toBe(
      (await app.get(ProfileLockPolicies).find(accountId, profileId))?.pinStamp,
    );

    const at = new Date();
    await repo.setPin({ accountId, profileId, pinHash: null, resetNoticeAt: at });
    expect((await repo.findDetails(accountId, profileId))?.pinResetNoticeAt).toEqual(at);
    // PIN-05 : lue autant de fois qu'on veut, jamais effacée par une lecture.
    expect((await repo.findDetails(accountId, profileId))?.pinResetNoticeAt).toEqual(at);
    await repo.setPin({
      accountId,
      profileId,
      pinHash: 'mien',
      expectedHash: null,
      resetNoticeAt: null,
    });
    expect((await repo.findDetails(accountId, profileId))?.pinResetNoticeAt).toBeNull();
  });
});

describe('PRO-01, PRO-08 : nombre de profils sous verrou du compte', () => {
  it('créations parallèles : 10 profils au plus', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => repo.create(accountId, newProfile(`P${i}`), new Date())),
    );
    expect(results.filter((r) => r === 'created')).toHaveLength(9);
    expect(await prisma.profile.count({ where: { accountId } })).toBe(10);
  });

  it('suppressions parallèles : jamais le dernier profil', async () => {
    const { accountId, profileId } = await createAccountWithProfile(prisma);
    const second = newProfile('Second');
    await repo.create(accountId, second, new Date());
    const results = await Promise.all([
      repo.delete(accountId, profileId),
      repo.delete(accountId, second.id),
    ]);
    expect(results.sort()).toEqual(['deleted', 'last']);
    expect(await prisma.profile.count({ where: { accountId } })).toBe(1);
  });

  it('modification conditionnelle à la version (API-17)', async () => {
    const { accountId, profileId } = await createAccountWithProfile(prisma);
    const updated = await repo.update(accountId, profileId, 1, {
      displayName: 'Nouveau',
      birthday: { day: 29, month: 2, year: null },
    });
    expect(updated).toMatchObject({
      status: 'updated',
      profile: { displayName: 'Nouveau', birthdayDay: 29, birthdayMonth: 2, version: 2 },
    });
    expect(await repo.update(accountId, profileId, 1, { displayName: 'X' })).toEqual({
      status: 'stale',
    });
    const other = await createAccountWithProfile(prisma);
    expect(await repo.update(other.accountId, profileId, 2, { displayName: 'X' })).toEqual({
      status: 'missing',
    });
  });
});

describe('Sélection de bout en bout (PRO-07, PIN-02)', () => {
  it('PIN juste : session déverrouillée dans Redis ; suppression du profil actif : retour à la sélection', async () => {
    const { accountId, profileId } = await profileWithPin('2468');
    const user = await signIn(app, { accountId });
    // PRO-04 : profil unique sélectionné d'office, verrouillé.
    const before = await request(app.getHttpServer())
      .get('/api/v1/session')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(before.body.session).toMatchObject({
      activeProfileId: profileId,
      profileUnlocked: false,
    });

    await request(app.getHttpServer())
      .post('/api/v1/session/profile')
      .set(user.mutation)
      .send({ profileId, pin: '2468' })
      .expect(200);
    const me = await request(app.getHttpServer())
      .get('/api/v1/profiles/me')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(me.body).toMatchObject({ id: profileId, hasPin: true });

    // Revue SEC-40, I1 : suppression par la route, sessions désélectionnées dans le cache aussi.
    const second = newProfile('Second');
    await repo.create(accountId, second, new Date());
    const rotated = await app.get(SessionLifecycle).rotate({
      id: user.sessionId,
      accountId,
      tokenHash: user.tokenHash,
    });
    const fresh = sessionHeaders(
      app,
      rotated.token,
      rotated.record.tokenHash,
      user.sessionId,
      accountId,
      profileId,
    );
    const events: IdentityEvent[] = [];
    const unsubscribe = app.get(IdentityEvents).subscribe((event) => events.push(event));
    try {
      await request(app.getHttpServer())
        .delete(`/api/v1/account/profiles/${profileId}`)
        .set(fresh.mutation)
        .expect(204);
    } finally {
      unsubscribe();
    }
    expect(events).toContainEqual({
      type: 'session.profile_changed',
      sessionId: user.sessionId,
      profileId: null,
    });
    const cached = await app.get(SessionStore).lookup(fresh.tokenHash);
    expect(cached.kind).toBe('cached');
    if (cached.kind === 'cached') {
      expect(cached.session.record).toMatchObject({ activeProfileId: null, reauthAt: null });
      expect(cached.session.unlock).toBeNull();
    }
    const row = await prisma.session.findUniqueOrThrow({ where: { id: user.sessionId } });
    expect(row).toMatchObject({ activeProfileId: null, reauthAt: null });
  });

  it('revue SEC-40, I2 : un déverrouillage obtenu avec l’ancien PIN ne vaut plus après une réinitialisation', async () => {
    const { accountId, profileId } = await profileWithPin('2468');
    const user = await signIn(app, { accountId });
    await request(app.getHttpServer())
      .post('/api/v1/session/profile')
      .set(user.mutation)
      .send({ profileId, pin: '2468' })
      .expect(200);
    const before = await app.get(SessionStore).lookup(user.tokenHash);
    if (before.kind !== 'cached' || !before.session.unlock) throw new Error('non déverrouillé');
    const staleUnlock = before.session.unlock;

    // Réinitialisation (nouveau hash), puis le déverrouillage d'avant réécrit, comme une course.
    await repo.setPin({
      accountId,
      profileId,
      pinHash: await hasher.hash('1357'),
      resetNoticeAt: new Date(),
    });
    await app.get(SessionStore).patchCache(user.tokenHash, { unlock: staleUnlock });
    await request(app.getHttpServer())
      .get('/api/v1/profiles/me')
      .set('Cookie', user.cookie)
      .expect(423);
  });
});
