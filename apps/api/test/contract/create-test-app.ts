import { randomUUID } from 'node:crypto';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { ExampleItemRepository, InMemoryExampleItemRepository } from '../../src/modules/example';
import {
  AccountRepository,
  BackgroundTasks,
  EventThrottle,
  FakeGoogleOidc,
  FakePasswordHasher,
  GoogleIdentityRepository,
  GoogleOidc,
  GoogleReauthProofs,
  InMemoryGoogleIdentityRepository,
  InMemoryGoogleReauthProofs,
  InMemoryOidcFlows,
  OidcFlows,
  IdentitySettings,
  InMemoryAccountRepository,
  InMemoryBackgroundTasks,
  InMemoryBreachChecker,
  InMemoryEventThrottle,
  InMemoryMailSender,
  InMemoryPendingSecondFactors,
  InMemorySecondFactorRepository,
  InMemoryTrustedDeviceRepository,
  InMemoryProfileLockPolicies,
  InMemoryRateLimiter,
  InMemorySecurityLog,
  InMemorySessionStore,
  MailSender,
  PasswordBreachChecker,
  PasswordHasher,
  PendingSecondFactors,
  ProfileLockPolicies,
  RateLimiter,
  SecondFactorRepository,
  SecurityLog,
  SessionStore,
  StaticIdentitySettings,
  TrustedDeviceRepository,
} from '../../src/modules/identity/testing';
import type { PinRelock } from '../../src/modules/identity/domain/session';
import { type SignedIn, signIn } from '../support/sign-in';

export interface TestIdentity {
  readonly sessions: InMemorySessionStore;
  readonly profiles: InMemoryProfileLockPolicies;
  readonly securityLog: InMemorySecurityLog;
  readonly mail: InMemoryMailSender;
  readonly accounts: InMemoryAccountRepository;
  readonly hasher: FakePasswordHasher;
  readonly breaches: InMemoryBreachChecker;
  readonly background: InMemoryBackgroundTasks;
  readonly rateLimiter: InMemoryRateLimiter;
  readonly settings: StaticIdentitySettings;
  readonly secondFactors: InMemorySecondFactorRepository;
  readonly trustedDevices: InMemoryTrustedDeviceRepository;
  readonly pendingSecondFactors: InMemoryPendingSecondFactors;
  readonly google: FakeGoogleOidc;
  readonly oidcFlows: InMemoryOidcFlows;
  readonly googleReauthProofs: InMemoryGoogleReauthProofs;
  readonly googleIdentities: InMemoryGoogleIdentityRepository;
  /** Compte neuf avec un profil actif ; sans PIN par défaut (donc déverrouillé). */
  signIn(options?: { pin?: boolean; relock?: PinRelock; withProfile?: boolean }): Promise<SignedIn>;
}

/** Application montée avec ses vrais réglages (filtre, validation, en-têtes, gardes), ports en mémoire. */
export async function createTestApp(
  options: { controllers?: Type[]; env?: Record<string, string> } = {},
): Promise<{
  app: INestApplication;
  exampleItems: InMemoryExampleItemRepository;
  identity: TestIdentity;
}> {
  const previousEnv = { ...process.env };
  Object.assign(process.env, options.env ?? {});

  const exampleItems = new InMemoryExampleItemRepository();
  const sessions = new InMemorySessionStore();
  const profiles = new InMemoryProfileLockPolicies();
  const securityLog = new InMemorySecurityLog();
  const mail = new InMemoryMailSender();
  const accounts = new InMemoryAccountRepository(sessions);
  const hasher = new FakePasswordHasher();
  const breaches = new InMemoryBreachChecker();
  const background = new InMemoryBackgroundTasks();
  const rateLimiter = new InMemoryRateLimiter();
  const settings = new StaticIdentitySettings();
  const secondFactors = new InMemorySecondFactorRepository(accounts, sessions);
  const trustedDevices = new InMemoryTrustedDeviceRepository(accounts);
  const pendingSecondFactors = new InMemoryPendingSecondFactors();
  const google = new FakeGoogleOidc();
  const oidcFlows = new InMemoryOidcFlows();
  const googleReauthProofs = new InMemoryGoogleReauthProofs();
  const googleIdentities = new InMemoryGoogleIdentityRepository(accounts, sessions);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(ExampleItemRepository)
    .useValue(exampleItems)
    .overrideProvider(SessionStore)
    .useValue(sessions)
    .overrideProvider(ProfileLockPolicies)
    .useValue(profiles)
    .overrideProvider(RateLimiter)
    .useValue(rateLimiter)
    .overrideProvider(EventThrottle)
    .useValue(new InMemoryEventThrottle())
    .overrideProvider(SecurityLog)
    .useValue(securityLog)
    .overrideProvider(MailSender)
    .useValue(mail)
    .overrideProvider(AccountRepository)
    .useValue(accounts)
    .overrideProvider(PasswordHasher)
    .useValue(hasher)
    .overrideProvider(PasswordBreachChecker)
    .useValue(breaches)
    .overrideProvider(BackgroundTasks)
    .useValue(background)
    .overrideProvider(IdentitySettings)
    .useValue(settings)
    .overrideProvider(SecondFactorRepository)
    .useValue(secondFactors)
    .overrideProvider(TrustedDeviceRepository)
    .useValue(trustedDevices)
    .overrideProvider(PendingSecondFactors)
    .useValue(pendingSecondFactors)
    .overrideProvider(GoogleOidc)
    .useValue(google)
    .overrideProvider(OidcFlows)
    .useValue(oidcFlows)
    .overrideProvider(GoogleReauthProofs)
    .useValue(googleReauthProofs)
    .overrideProvider(GoogleIdentityRepository)
    .useValue(googleIdentities)
    .compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  process.env = previousEnv;

  const identity: TestIdentity = {
    sessions,
    profiles,
    securityLog,
    mail,
    accounts,
    hasher,
    breaches,
    background,
    rateLimiter,
    settings,
    secondFactors,
    trustedDevices,
    pendingSecondFactors,
    google,
    oidcFlows,
    googleReauthProofs,
    googleIdentities,
    async signIn({ pin = false, relock = 'IDLE_15', withProfile = true } = {}) {
      const accountId = randomUUID();
      const profileId = randomUUID();
      sessions.addAccount(accountId);
      profiles.set({ profileId, accountId, hasPin: pin, relock });
      return signIn(app, { accountId, profileId: withProfile ? profileId : null });
    },
  };
  return { app, exampleItems, identity };
}
