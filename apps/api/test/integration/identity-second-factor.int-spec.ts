import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generate } from 'otplib';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { SecretCipher } from '../../src/modules/identity/domain/second-factor.ports';
import { PENDING_COOKIE, PRESESSION_COOKIE } from '../../src/modules/identity/presentation/cookies';
import {
  AccountRepository,
  BackgroundTasks,
  InMemoryBackgroundTasks,
  InMemoryMailSender,
  MailSender,
  PasswordHasher,
  PendingSecondFactors,
  SecondFactorRepository,
  TrustedDeviceRepository,
} from '../../src/modules/identity/testing';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import {
  createAccountWithProfile,
  session as sessionHeaders,
  WEB_ORIGIN,
} from '../support/sign-in';

// Second facteur contre PostgreSQL et Redis réels : anti-rejeu atomique (AUTH-11), usage unique des
// codes de secours, activation conditionnelle, désactivation en une transaction, chiffrement au
// repos (SEC-22), pré-authentification à usage unique (ADR 0013), contraintes DAT-01.

let app: INestApplication;
let prisma: PrismaService;
let repo: SecondFactorRepository;
let devices: TrustedDeviceRepository;
let pending: PendingSecondFactors;
const background = new InMemoryBackgroundTasks();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailSender)
    .useValue(new InMemoryMailSender())
    .overrideProvider(BackgroundTasks)
    .useValue(background)
    .compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  repo = app.get(SecondFactorRepository);
  devices = app.get(TrustedDeviceRepository);
  pending = app.get(PendingSecondFactors);
});

afterAll(async () => {
  await app.close();
});

const hex64 = (): string => randomUUID().replace(/-/g, '').padEnd(64, '0');

/** Compte avec TOTP actif au pas `step`, et deux codes de secours. */
async function enabledAccount(step = 100): Promise<{ accountId: string; secretEnc: Uint8Array }> {
  const { accountId } = await createAccountWithProfile(prisma);
  const secretEnc = app.get(SecretCipher).encrypt('JBSWY3DPEHPK3PXP', `totp:${accountId}`);
  expect(await repo.startEnrollment(accountId, secretEnc, new Date())).toBe(true);
  expect(
    await repo.activate({
      accountId,
      secretEnc,
      step,
      authEpoch: 0,
      recoveryCodeHashes: [hex64(), hex64()],
      now: new Date(),
    }),
  ).toBe(true);
  return { accountId, secretEnc };
}

describe('PrismaSecondFactorRepository', () => {
  it('SEC-22 : seul le chiffré est en base', async () => {
    const { accountId } = await enabledAccount();
    const row = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(Buffer.from(row.totpSecretEnc ?? []).toString('latin1')).not.toContain(
      'JBSWY3DPEHPK3PXP',
    );
    expect(row.totpEnabledAt).not.toBeNull();
    expect(row.totpLastStep).toBe(100);
  });

  it('activation conditionnelle : refusée si le secret en attente a changé, ou déjà active', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const cipher = app.get(SecretCipher);
    const first = cipher.encrypt('AAAA', `totp:${accountId}`);
    const second = cipher.encrypt('BBBB', `totp:${accountId}`);
    await repo.startEnrollment(accountId, first, new Date());
    await repo.startEnrollment(accountId, second, new Date());
    const input = {
      accountId,
      step: 5,
      authEpoch: 0,
      recoveryCodeHashes: [hex64()],
      now: new Date(),
    };
    expect(await repo.activate({ ...input, secretEnc: first })).toBe(false);
    expect(await repo.activate({ ...input, secretEnc: second })).toBe(true);
    expect(await repo.activate({ ...input, secretEnc: second })).toBe(false);
    expect(await repo.startEnrollment(accountId, first, new Date())).toBe(false);
  });

  it('AUTH-11 : un pas n’est accepté qu’une fois, même en concurrence ; jamais un pas antérieur', async () => {
    const { accountId } = await enabledAccount(100);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repo.consumeStep(accountId, 101)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await repo.consumeStep(accountId, 101)).toBe(false);
    expect(await repo.consumeStep(accountId, 100)).toBe(false);
    expect(await repo.consumeStep(accountId, 102)).toBe(true);
  });

  it('code de secours à usage unique, même en concurrence', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const secretEnc = app.get(SecretCipher).encrypt('JBSWY3DPEHPK3PXP', `totp:${accountId}`);
    const code = hex64();
    await repo.startEnrollment(accountId, secretEnc, new Date());
    await repo.activate({
      accountId,
      secretEnc,
      step: 1,
      authEpoch: 0,
      recoveryCodeHashes: [code],
      now: new Date(),
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repo.consumeRecoveryCode(accountId, code, new Date())),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await repo.countUnusedRecoveryCodes(accountId)).toBe(0);
    // Codes d'un autre compte : jamais acceptés.
    const other = await enabledAccount();
    expect(await repo.consumeRecoveryCode(other.accountId, code, new Date())).toBe(false);
  });

  it('régénération : anciens codes supprimés ; refusée sans TOTP', async () => {
    const { accountId } = await enabledAccount();
    const fresh = [hex64(), hex64(), hex64()];
    expect(await repo.replaceRecoveryCodes(accountId, fresh, new Date())).toBe(true);
    expect(await repo.countUnusedRecoveryCodes(accountId)).toBe(3);
    const plain = await createAccountWithProfile(prisma);
    expect(await repo.replaceRecoveryCodes(plain.accountId, fresh, new Date())).toBe(false);
  });

  it('AUTH-05 : désactivation en une transaction (secret, pas, codes, appareils, époque)', async () => {
    const { accountId } = await enabledAccount();
    const now = new Date();
    await devices.create({
      id: randomUUID(),
      accountId,
      tokenHash: hex64(),
      userAgent: 'test',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const before = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await repo.disable(accountId, before.authEpoch + 2, now);
    const after = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(after).toMatchObject({
      totpSecretEnc: null,
      totpEnabledAt: null,
      totpLastStep: null,
      authEpoch: before.authEpoch + 2,
    });
    expect(await prisma.recoveryCode.count({ where: { accountId } })).toBe(0);
    expect(await devices.listActive(accountId, now)).toEqual([]);
    expect(await repo.consumeStep(accountId, 1_000)).toBe(false);
  });

  it('DAT-01 : un pas sans TOTP actif, ou un hash mal formé, est refusé par la base', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    await expect(
      prisma.account.update({ where: { id: accountId }, data: { totpLastStep: 3 } }),
    ).rejects.toThrow();
    await expect(
      prisma.recoveryCode.create({
        data: { id: randomUUID(), accountId, codeHash: 'Z'.repeat(64) },
      }),
    ).rejects.toThrow();
  });
});

describe('PrismaTrustedDeviceRepository (AUTH-12)', () => {
  it('révocation limitée au compte ; expiré ou révoqué ignoré', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const other = await createAccountWithProfile(prisma);
    const now = new Date();
    const id = randomUUID();
    const tokenHash = hex64();
    await devices.create({
      id,
      accountId,
      tokenHash,
      userAgent: 'test',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(await devices.findActive(tokenHash, now)).toEqual({ id, accountId });
    expect(await devices.findActive(tokenHash, new Date(now.getTime() + 120_000))).toBeNull();
    expect(await devices.revoke(other.accountId, id, now)).toBe(false);
    expect(await devices.revoke(accountId, id, now)).toBe(true);
    expect(await devices.findActive(tokenHash, now)).toBeNull();
    expect(await devices.revoke(accountId, id, now)).toBe(false);
  });
});

describe('Réinitialisation du mot de passe (AUTH-06, AUTH-12)', () => {
  it('révoque les appareils de confiance du compte en base', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const now = new Date();
    const tokenHash = hex64();
    await devices.create({
      id: randomUUID(),
      accountId,
      tokenHash,
      userAgent: 'test',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const before = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await app.get(AccountRepository).setPassword({
      accountId,
      passwordHash: 'hash-factice',
      authEpoch: before.authEpoch + 2,
      reset: true,
      now,
    });
    expect(await devices.findActive(tokenHash, now)).toBeNull();
  });
});

describe('RedisPendingSecondFactors (ADR 0013)', () => {
  it('usage unique, même en concurrence ; durée de vie posée', async () => {
    const hash = hex64();
    const value = { accountId: randomUUID(), epoch: 3, createdAt: new Date() };
    await pending.create(hash, value, 300_000);
    expect(await pending.find(hash)).toEqual(value);
    const results = await Promise.all(Array.from({ length: 6 }, () => pending.consume(hash)));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await pending.find(hash)).toBeNull();
  });
});

describe('Parcours complet contre la base (AUTH-10 à AUTH-12)', () => {
  it('activation, connexion en deux étapes, rejeu refusé', async () => {
    const http = request(app.getHttpServer());
    const email = `sf-${randomUUID()}@lahotte.test`;
    const password = 'une phrase de passe assez longue';
    const { accountId } = await createAccountWithProfile(prisma);
    await prisma.account.update({
      where: { id: accountId },
      data: { email, passwordHash: await app.get(PasswordHasher).hash(password) },
    });

    // Session ré-authentifiée, puis inscription et activation.
    const lifecycle = app.get(SessionLifecycle);
    const opened = await lifecycle.create({
      accountId,
      observedEpoch: (await lifecycle.observeEpoch(accountId)) ?? -1,
      userAgent: 'test',
    });
    const rotated = await lifecycle.rotate({
      id: opened.record.id,
      accountId,
      tokenHash: opened.record.tokenHash,
    });
    const user = sessionHeaders(
      app,
      rotated.token,
      rotated.record.tokenHash,
      rotated.record.id,
      accountId,
      null,
    );
    const enrolled = await http.post('/api/v1/auth/totp/enroll').set(user.mutation).expect(200);
    const secret = enrolled.body.secret as string;
    const now = Math.floor(Date.now() / 1000);
    await http
      .post('/api/v1/auth/totp/activate')
      .set(user.mutation)
      .send({ code: await generate({ secret, epoch: now }) })
      .expect(200);

    const pre = await http.get('/api/v1/session').expect(200);
    const presession = (pre.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))
      ?.split(';')[0];
    const before = {
      Cookie: presession ?? '',
      'X-CSRF-Token': pre.body.csrfToken as string,
      Origin: WEB_ORIGIN,
    };
    const loginPending = async (): Promise<Record<string, string>> => {
      const res = await http
        .post('/api/v1/auth/login')
        .set(before)
        .send({ email, password })
        .expect(200);
      expect(res.body.secondFactorPending).toBe(true);
      const cookie = (res.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith(`${PENDING_COOKIE}=`))
        ?.split(';')[0];
      return { ...before, Cookie: `${before.Cookie}; ${cookie ?? ''}` };
    };

    const code = await generate({ secret, epoch: now + 30 });
    await http
      .post('/api/v1/auth/totp/verify')
      .set(await loginPending())
      .send({ code })
      .expect(200);
    await http
      .post('/api/v1/auth/totp/verify')
      .set(await loginPending())
      .send({ code })
      .expect(401);
    await background.flush();
  });
});
