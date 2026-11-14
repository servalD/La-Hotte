import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { PRESESSION_COOKIE, SESSION_COOKIE } from '../../src/modules/identity/presentation/cookies';
import {
  BackgroundTasks,
  GoogleIdentityRepository,
  GoogleReauthProofs,
  InMemoryBackgroundTasks,
  InMemoryMailSender,
  MailSender,
  OidcFlows,
} from '../../src/modules/identity/testing';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { type FakeOidcProvider, startFakeOidcProvider } from '../support/fake-oidc-provider';
import { createAccountWithProfile, WEB_ORIGIN } from '../support/sign-in';

// Google contre PostgreSQL, Redis et le vrai `openid-client` (fournisseur local) : unicité des
// identités (AUTH-03, `12`), dissociation en une transaction (ADR 0014), parcours à usage unique
// en Redis (ADR 0013), inscription de bout en bout.

let app: INestApplication;
let prisma: PrismaService;
let identities: GoogleIdentityRepository;
let flows: OidcFlows;
let proofs: GoogleReauthProofs;
let provider: FakeOidcProvider;
const previousEnv = { ...process.env };

beforeAll(async () => {
  provider = await startFakeOidcProvider();
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: provider.clientId,
    GOOGLE_CLIENT_SECRET: provider.clientSecret,
    GOOGLE_OIDC_ISSUER: provider.issuer,
    REGISTRATION_MODE: 'OPEN',
  });
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
  identities = app.get(GoogleIdentityRepository);
  flows = app.get(OidcFlows);
  proofs = app.get(GoogleReauthProofs);
});

afterAll(async () => {
  await app.close();
  await provider.close();
  process.env = previousEnv;
});

const sub = (): string => `g${randomBytes(8).toString('hex')}`;

async function newSubjectAccount(): Promise<{ accountId: string; subject: string }> {
  const { accountId } = await createAccountWithProfile(prisma);
  const subject = sub();
  expect(await identities.link({ id: randomUUID(), accountId, subject, now: new Date() })).toBe(
    'linked',
  );
  return { accountId, subject };
}

describe('PrismaGoogleIdentityRepository (AUTH-03)', () => {
  it('un identifiant Google ne va qu’à un compte ; un compte n’a qu’une identité Google', async () => {
    const { accountId, subject } = await newSubjectAccount();
    expect(await identities.findAccountBySubject(subject)).toBe(accountId);
    expect(await identities.findSubject(accountId)).toBe(subject);

    const other = await createAccountWithProfile(prisma);
    expect(
      await identities.link({
        id: randomUUID(),
        accountId: other.accountId,
        subject,
        now: new Date(),
      }),
    ).toBe('subject_taken');
    expect(
      await identities.link({ id: randomUUID(), accountId, subject: sub(), now: new Date() }),
    ).toBe('already_linked');
  });

  it('deux associations concurrentes du même compte : une seule passe', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const results = await Promise.all(
      [sub(), sub(), sub()].map((subject) =>
        identities.link({ id: randomUUID(), accountId, subject, now: new Date() }),
      ),
    );
    expect(results.filter((r) => r === 'linked')).toHaveLength(1);
    expect(await prisma.authIdentity.count({ where: { accountId } })).toBe(1);
  });

  it('AUTH-15 : compte non vérifié, pas d’association', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    await prisma.account.update({ where: { id: accountId }, data: { emailVerifiedAt: null } });
    expect(
      await identities.link({ id: randomUUID(), accountId, subject: sub(), now: new Date() }),
    ).toBe('not_eligible');
  });

  it('DAT-01 : un sub mal formé est refusé par la base', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    await expect(
      prisma.authIdentity.create({
        data: { id: randomUUID(), accountId, provider: 'GOOGLE', subject: 'avec espace' },
      }),
    ).rejects.toThrow();
  });

  it('dissociation : sans mot de passe, refusée ; avec, faite, époque écrite en avant', async () => {
    const { accountId } = await newSubjectAccount();
    expect(await identities.unlink(accountId, 7)).toBe('no_password');
    expect(await identities.findSubject(accountId)).not.toBeNull();
    await prisma.account.update({ where: { id: accountId }, data: { passwordHash: 'hash' } });
    expect(await identities.unlink(accountId, 9)).toBe('unlinked');
    expect(await identities.findSubject(accountId)).toBeNull();
    expect(await identities.unlink(accountId, 3)).toBe('not_linked');
    const row = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(row.authEpoch).toBe(9);
  });

  it('création : compte vérifié sans mot de passe ; adresse ou sub pris refusés', async () => {
    const accountId = randomUUID();
    const subject = sub();
    const email = `${subject}@gmail.test`;
    const account = (id: string, s: string, e: string) => ({
      id,
      email: e,
      subject: s,
      identityId: randomUUID(),
      ageAttestedAt: new Date(),
      createdAt: new Date(),
      profile: {
        id: randomUUID(),
        displayName: 'Camille',
        accentColor: '#336699',
        locale: 'fr',
        currency: 'EUR',
        timezone: 'Europe/Paris',
      },
    });
    expect(await identities.createAccount(account(accountId, subject, email))).toBe('created');
    const row = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(row.passwordHash).toBeNull();
    expect(await identities.createAccount(account(randomUUID(), sub(), email))).toBe('email_taken');
    expect(
      await identities.createAccount(account(randomUUID(), subject, `${sub()}@gmail.test`)),
    ).toBe('subject_taken');
  });
});

describe('Redis : parcours et preuves (ADR 0013)', () => {
  const flow = {
    kind: 'login' as const,
    binding: 'b'.repeat(64),
    accountId: null,
    epoch: null,
    nonce: 'n',
    codeVerifier: 'v',
    registration: {
      displayName: 'Camille',
      locale: null,
      timezone: 'Europe/Paris',
      invitationTokenHash: null,
    },
    createdAt: new Date(),
  };

  it('state à usage unique, même en concurrence', async () => {
    const key = randomBytes(32).toString('hex');
    await flows.create(key, flow, 60_000);
    const results = await Promise.all([flows.consume(key), flows.consume(key), flows.consume(key)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(results.find((r) => r !== null)).toEqual(flow);
  });

  it('preuve de ré-authentification : lue sans être consommée, puis consommée une fois', async () => {
    const sessionId = randomUUID();
    const proof = { tokenHash: 'h'.repeat(64), epoch: 3, createdAt: new Date() };
    await proofs.create(sessionId, proof, 60_000);
    expect(await proofs.find(sessionId)).toEqual(proof);
    expect(await proofs.consume(sessionId)).toEqual(proof);
    expect(await proofs.consume(sessionId)).toBeNull();
  });
});

describe('Inscription par Google de bout en bout (vrai openid-client)', () => {
  it('compte créé, session ouverte ; le même retour rejoué est refusé', async () => {
    const http = request(app.getHttpServer());
    const pre = await http.get('/api/v1/session').expect(200);
    const presession = (pre.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))
      ?.split(';')[0];
    const started = await http
      .post('/api/v1/auth/google/start')
      .set({
        Cookie: presession ?? '',
        'X-CSRF-Token': pre.body.csrfToken as string,
        Origin: WEB_ORIGIN,
      })
      .send({ registration: { displayName: 'Camille', ageAttested: true } })
      .expect(200);
    const url = started.body.authorizationUrl as string;
    const subject = sub();
    const code = provider.issueCode(url, { sub: subject, email: `${subject}@gmail.test` });
    const state = new URL(url).searchParams.get('state') ?? '';
    const query = new URLSearchParams({ state, code }).toString();

    const res = await http
      .get(`/api/v1/auth/google/callback?${query}`)
      .set('Cookie', presession ?? '');
    expect(res.status).toBe(303);
    expect(new URL(res.headers.location as string).searchParams.get('status')).toBe('signed_in');
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
    const accountId = await identities.findAccountBySubject(subject);
    expect(accountId).not.toBeNull();

    const replay = await http
      .get(`/api/v1/auth/google/callback?${query}`)
      .set('Cookie', presession ?? '');
    expect(new URL(replay.headers.location as string).searchParams.get('error')).toBe(
      'GOOGLE_FLOW_INVALID',
    );

    // Nettoyage : sessions révoquées avant toute suppression (ADR 0013, `RESTRICT`).
    if (accountId) await app.get(SessionLifecycle).revokeAll(accountId);
  });
});
