import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PurgeUnverifiedAccounts } from '../../src/modules/identity/application/purge-unverified-accounts.use-case';
import type { NewAccountToken } from '../../src/modules/identity/domain/account';
import {
  AccountRepository,
  BackgroundTasks,
  InMemoryBackgroundTasks,
  InMemoryBreachChecker,
  InMemoryMailSender,
  MailSender,
  PasswordBreachChecker,
  PasswordHasher,
} from '../../src/modules/identity/testing';
import { PRESESSION_COOKIE, SESSION_COOKIE } from '../../src/modules/identity/presentation/cookies';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, signIn, WEB_ORIGIN } from '../support/sign-in';

// Comptes par mot de passe contre PostgreSQL et Redis réels : transactions, usage unique des
// jetons, époque (ADR 0014), purge (AUTH-15), argon2id (AUTH-02).

let app: INestApplication;
let prisma: PrismaService;
let accounts: AccountRepository;
const mail = new InMemoryMailSender();
const background = new InMemoryBackgroundTasks();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // Pas d'appel réseau vers le service des fuites ; e-mails et tâches de fond observables.
    .overrideProvider(PasswordBreachChecker)
    .useValue(new InMemoryBreachChecker())
    .overrideProvider(MailSender)
    .useValue(mail)
    .overrideProvider(BackgroundTasks)
    .useValue(background)
    .compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  accounts = app.get(AccountRepository);
});

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());
const PASSWORD = 'une phrase de passe assez longue';
const hex64 = (): string => randomUUID().replace(/-/g, '').padEnd(64, '0');

function token(accountId: string, overrides: Partial<NewAccountToken> = {}): NewAccountToken {
  const now = new Date();
  return {
    id: randomUUID(),
    accountId,
    purpose: 'PASSWORD_RESET',
    tokenHash: hex64(),
    newEmail: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
    ...overrides,
  };
}

/** Clé de la limitation par IP : chaque test vide ses compteurs (adresse partagée). */
async function resetRateLimits(): Promise<void> {
  const { RedisService } = await import('../../src/platform/redis/redis.service');
  const client = await app.get(RedisService).ready();
  const keys = await client.keys('rl*');
  if (keys.length > 0) await client.del(...keys);
}

async function presession(): Promise<Record<string, string>> {
  const res = await http().get('/api/v1/session').expect(200);
  const raw = ([] as string[]).concat(
    (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [],
  );
  const cookie = raw.find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))?.split(';')[0] ?? '';
  return { Cookie: cookie, 'X-CSRF-Token': res.body.csrfToken as string, Origin: WEB_ORIGIN };
}

describe('PrismaAccountRepository', () => {
  it('AUTH-09 : deux inscriptions concurrentes de la même adresse — une seule réussit', async () => {
    const email = `c-${randomUUID()}@lahotte.test`;
    const attempt = () => {
      const id = randomUUID();
      return accounts.create(
        {
          id,
          email,
          passwordHash: 'h',
          ageAttestedAt: new Date(),
          createdAt: new Date(),
          profile: {
            id: randomUUID(),
            displayName: 'Camille',
            accentColor: '#2b5c8a',
            locale: 'fr',
            currency: 'EUR',
            timezone: 'Europe/Paris',
          },
        },
        token(id, { purpose: 'EMAIL_VERIFY', expiresAt: new Date(Date.now() + 86_400_000) }),
      );
    };
    const results = await Promise.all([attempt(), attempt(), attempt()]);
    expect(results.filter((r) => r === 'created')).toHaveLength(1);
    expect(results.filter((r) => r === 'email_taken')).toHaveLength(2);
    // Aucun profil orphelin : la transaction a tout annulé pour les perdants.
    const account = await prisma.account.findUnique({ where: { email } });
    expect(await prisma.profile.count({ where: { accountId: account?.id } })).toBe(1);
  });

  it('jeton à usage unique, même sous concurrence ; expiré, autre usage ou compte suspendu : refusé', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const valid = token(accountId);
    await accounts.issueToken(valid);
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        accounts.consumeToken(valid.tokenHash, ['PASSWORD_RESET'], now),
      ),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);

    const expired = token(accountId, {
      purpose: 'EMAIL_VERIFY',
      createdAt: new Date(now.getTime() - 2000),
      expiresAt: new Date(now.getTime() - 1000),
    });
    await accounts.issueToken(expired);
    expect(await accounts.consumeToken(expired.tokenHash, ['EMAIL_VERIFY'], now)).toBeNull();

    const other = token(accountId);
    await accounts.issueToken(other);
    expect(await accounts.consumeToken(other.tokenHash, ['EMAIL_VERIFY'], now)).toBeNull();

    await prisma.account.update({ where: { id: accountId }, data: { status: 'SUSPENDED' } });
    expect(await accounts.consumeToken(other.tokenHash, ['PASSWORD_RESET'], now)).toBeNull();
  });

  it('un nouveau jeton invalide les précédents du même usage, sauf l’annulation (AUTH-16)', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const first = token(accountId);
    const second = token(accountId);
    await accounts.issueToken(first);
    await accounts.issueToken(second);
    expect(await accounts.consumeToken(first.tokenHash, ['PASSWORD_RESET'], new Date())).toBeNull();

    const cancelA = token(accountId, {
      purpose: 'EMAIL_CHANGE_CANCEL',
      newEmail: 'ancienne@lahotte.test',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const cancelB = { ...cancelA, id: randomUUID(), tokenHash: hex64() };
    await accounts.issueToken(cancelA);
    await accounts.issueToken(cancelB);
    expect(
      await accounts.consumeToken(cancelA.tokenHash, ['EMAIL_CHANGE_CANCEL'], new Date()),
    ).not.toBeNull();
  });

  it('ADR 0014 : l’époque écrite ne recule jamais (GREATEST) ; réinitialisation : e-mail vérifié, appareils révoqués', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    await prisma.account.update({
      where: { id: accountId },
      data: { authEpoch: 10, emailVerifiedAt: null },
    });
    const device = await prisma.trustedDevice.create({
      data: {
        id: randomUUID(),
        accountId,
        tokenHash: hex64(),
        userAgent: 'test',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await accounts.setPassword({
      accountId,
      passwordHash: 'nouveau',
      authEpoch: 4,
      reset: true,
      now: new Date(),
    });
    const row = await prisma.account.findUnique({ where: { id: accountId } });
    expect(row?.authEpoch).toBe(10);
    expect(row?.passwordHash).toBe('nouveau');
    expect(row?.emailVerifiedAt).not.toBeNull();
    expect(
      (await prisma.trustedDevice.findUnique({ where: { id: device.id } }))?.revokedAt,
    ).not.toBeNull();
  });

  it('AUTH-16 (revue cycle 2, M1 et M2) : adresse reprise — rien n’est écrit, le lien reste utilisable', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const { accountId: otherId } = await createAccountWithProfile(prisma);
    await prisma.account.update({ where: { id: accountId }, data: { passwordHash: 'h' } });
    const taken = (await prisma.account.findUnique({ where: { id: otherId } }))?.email ?? '';
    const cancel = token(accountId, {
      purpose: 'EMAIL_CHANGE_CANCEL',
      newEmail: taken,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await accounts.issueToken(cancel);
    const result = await accounts.restoreEmail({
      tokenHash: cancel.tokenHash,
      accountId,
      authEpoch: 7,
      now: new Date(),
    });
    expect(result).toEqual({ status: 'taken' });
    const row = await prisma.account.findUnique({ where: { id: accountId } });
    // Tout ou rien : ni mot de passe effacé, ni époque écrite, jeton toujours ouvert.
    expect(row?.passwordHash).toBe('h');
    expect(row?.authEpoch).toBe(0);
    expect(
      await accounts.findOpenToken(cancel.tokenHash, ['EMAIL_CHANGE_CANCEL'], new Date()),
    ).not.toBeNull();
    // Jeton d'un autre compte : refusé sans rien écrire.
    expect(
      await accounts.restoreEmail({
        tokenHash: cancel.tokenHash,
        accountId: otherId,
        authEpoch: 7,
        now: new Date(),
      }),
    ).toEqual({ status: 'invalid' });
  });
});

describe('AUTH-16 contre PostgreSQL (revue de la tranche 2, B1 et B2)', () => {
  it('une annulation désarme les liens d’annulation émis après elle, pas ceux d’avant ; adresse réservée', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const { accountId: otherId } = await createAccountWithProfile(prisma);
    const base = Date.now();
    const cancel = (offsetMs: number, newEmail: string): NewAccountToken =>
      token(accountId, {
        purpose: 'EMAIL_CHANGE_CANCEL',
        newEmail,
        createdAt: new Date(base + offsetMs),
        expiresAt: new Date(base + offsetMs + 86_400_000),
      });
    const older = cancel(0, `v-${randomUUID()}@lahotte.test`);
    const victim = cancel(1000, `v-${randomUUID()}@lahotte.test`);
    const later = cancel(2000, `a-${randomUUID()}@lahotte.test`);
    const reset = token(accountId);
    for (const t of [older, victim, later, reset]) await accounts.issueToken(t);

    // B2 : l'adresse portée par un lien d'annulation ouvert est réservée aux autres comptes.
    const now = new Date();
    expect(await accounts.isEmailReserved(victim.newEmail ?? '', null, now)).toBe(true);
    expect(await accounts.isEmailReserved(victim.newEmail ?? '', accountId, now)).toBe(false);
    expect(await accounts.changeEmail(otherId, victim.newEmail ?? '', now)).toBe(false);

    const result = await accounts.restoreEmail({
      tokenHash: victim.tokenHash,
      accountId,
      authEpoch: 3,
      now,
    });
    expect(result).toEqual({ status: 'restored', email: victim.newEmail });
    const row = await prisma.account.findUnique({ where: { id: accountId } });
    expect(row?.email).toBe(victim.newEmail);
    expect(row?.passwordHash).toBeNull();
    expect(row?.authEpoch).toBe(3);
    expect(await accounts.consumeToken(victim.tokenHash, ['EMAIL_CHANGE_CANCEL'], now)).toBeNull();
    expect(await accounts.consumeToken(later.tokenHash, ['EMAIL_CHANGE_CANCEL'], now)).toBeNull();
    expect(await accounts.consumeToken(reset.tokenHash, ['PASSWORD_RESET'], now)).toBeNull();
    expect(
      await accounts.consumeToken(older.tokenHash, ['EMAIL_CHANGE_CANCEL'], now),
    ).not.toBeNull();
  });
});

describe('Parcours complet, stockage réel', () => {
  beforeEach(async () => {
    await resetRateLimits();
  });

  it('inscription, vérification, connexion ; changement de mot de passe : les autres sessions tombent', async () => {
    const email = `p-${randomUUID()}@lahotte.test`;
    await http()
      .post('/api/v1/auth/register')
      .set(await presession())
      .send({ email, password: PASSWORD, displayName: 'Camille', ageAttested: true })
      .expect(202);
    await background.flush();
    const stored = await prisma.account.findUnique({ where: { email } });
    // AUTH-02 : argon2id réel, jamais le mot de passe en clair.
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    const verifyToken = mail.lastToken(email);
    await http()
      .post('/api/v1/auth/email/verify')
      .set(await presession())
      .send({ token: verifyToken })
      .expect(204);

    const loginOnce = async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .set(await presession())
        .send({ email, password: PASSWORD })
        .expect(200);
      const raw = ([] as string[]).concat(
        (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [],
      );
      const sessionToken = raw.find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0] ?? '';
      return { cookie: sessionToken, csrf: res.body.csrfToken as string };
    };
    const other = await loginOnce();
    const mine = await loginOnce();
    const mutation = (s: { cookie: string; csrf: string }) => ({
      Cookie: s.cookie,
      'X-CSRF-Token': s.csrf,
      Origin: WEB_ORIGIN,
    });
    const reauthed = await http()
      .post('/api/v1/auth/reauth')
      .set(mutation(mine))
      .send({ password: PASSWORD })
      .expect(200);
    const raw = ([] as string[]).concat(
      (reauthed.headers['set-cookie'] as unknown as string[] | undefined) ?? [],
    );
    const fresh = {
      cookie: raw.find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0] ?? '',
      csrf: reauthed.body.csrfToken as string,
    };
    await http()
      .put('/api/v1/auth/password')
      .set(mutation(fresh))
      .send({ newPassword: 'nouvelle phrase de passe' })
      .expect(200);
    await http().get('/api/v1/sessions').set('Cookie', other.cookie).expect(401);
    await http().get('/api/v1/sessions').set('Cookie', fresh.cookie).expect(401);
    const rows = await prisma.session.count({ where: { accountId: stored?.id } });
    expect(rows).toBe(1);
  });

  it('AUTH-15 : purge — sessions révoquées (marque posée), profils et compte supprimés, journal', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    await prisma.account.update({
      where: { id: accountId },
      data: { emailVerifiedAt: null, createdAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    const user = await signIn(app, { accountId });
    // Une autre purge a pu laisser des comptes : on ne regarde que celui-ci.
    await app.get(PurgeUnverifiedAccounts).execute();
    expect(await prisma.account.findUnique({ where: { id: accountId } })).toBeNull();
    expect(await prisma.profile.count({ where: { accountId } })).toBe(0);
    expect(await prisma.session.count({ where: { accountId } })).toBe(0);
    await http().get('/api/v1/sessions').set('Cookie', user.cookie).expect(401);
    expect(await prisma.securityLog.count({ where: { accountId, event: 'account.purged' } })).toBe(
      1,
    );
  });

  it('AUTH-15 : un compte vérifié n’est jamais purgé', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    await prisma.account.update({
      where: { id: accountId },
      data: { createdAt: new Date(Date.now() - 30 * 86_400_000) },
    });
    await app.get(PurgeUnverifiedAccounts).execute();
    expect(await prisma.account.findUnique({ where: { id: accountId } })).not.toBeNull();
  });

  it('revue SEC-40 (point 1) : DELETE /sessions/{id} d’un autre compte — 404, aucune marque posée', async () => {
    const mine = await createAccountWithProfile(prisma);
    const theirs = await createAccountWithProfile(prisma);
    const user = await signIn(app, { accountId: mine.accountId });
    const victim = await signIn(app, { accountId: theirs.accountId });
    await http().delete(`/api/v1/sessions/${victim.sessionId}`).set(user.mutation).expect(404);
    const { RedisService } = await import('../../src/platform/redis/redis.service');
    expect(await app.get(RedisService).client.exists(`sess-revoked:${victim.tokenHash}`)).toBe(0);
    await http().get('/api/v1/sessions').set('Cookie', victim.cookie).expect(200);
  });
});

describe('Argon2PasswordHasher (AUTH-02)', () => {
  it('vérifie, refuse un mauvais mot de passe, un hash illisible, et sans hash', async () => {
    const hasher = app.get(PasswordHasher);
    const hash = await hasher.hash(PASSWORD);
    expect(await hasher.verify(hash, PASSWORD)).toBe(true);
    expect(await hasher.verify(hash, `${PASSWORD}!`)).toBe(false);
    expect(await hasher.verify('pas un hash', PASSWORD)).toBe(false);
    expect(await hasher.verify(null, PASSWORD)).toBe(false);
  });
});
