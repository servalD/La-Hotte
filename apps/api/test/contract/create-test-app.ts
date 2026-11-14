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
  InMemoryLinkRepository,
  InMemoryMailSender,
  InMemoryPendingSecondFactors,
  InMemorySecondFactorRepository,
  InMemoryTrustedDeviceRepository,
  InMemoryProfileLockPolicies,
  InMemoryProfileRepository,
  InMemoryRateLimiter,
  LinkRepository,
  InMemorySecurityLog,
  InMemorySessionStore,
  MailSender,
  PasswordBreachChecker,
  PasswordHasher,
  PendingSecondFactors,
  ProfileLockPolicies,
  ProfileRepository,
  RateLimiter,
  SecondFactorRepository,
  SecurityLog,
  SessionStore,
  StaticIdentitySettings,
  TrustedDeviceRepository,
  InMemoryWardRepository,
  WardRepository,
  InMemoryTransferRepository,
  TransferRepository,
} from '../../src/modules/identity/testing';
import type { PinRelock } from '../../src/modules/identity/domain/session';
import { type SignedIn, signIn } from '../support/sign-in';

export interface TestIdentity {
  readonly sessions: InMemorySessionStore;
  readonly profiles: InMemoryProfileLockPolicies;
  /** Même magasin que `profiles` et `accounts.profiles`. */
  readonly profileRepository: InMemoryProfileRepository;
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
  /** Liens, blocages et invitations (LNK-01 à LNK-10) ; profils partagés avec `accounts`. */
  readonly links: InMemoryLinkRepository;
  /** Comptes sous tutelle (PRO-15, PRO-16) ; comptes, profils et liens partagés. */
  readonly wards: InMemoryWardRepository;
  /** Passages, détachements (PRO-12 à PRO-14). */
  readonly transfers: InMemoryTransferRepository;
  /**
   * Compte neuf avec un profil actif ; sans PIN par défaut (donc déverrouillé), `TEST_PIN`
   * sinon. `withProfile: false` : compte sans aucun profil.
   */
  signIn(options?: {
    pin?: boolean;
    relock?: PinRelock;
    withProfile?: boolean;
    /** PRO-05 : profil enfant. */
    isChild?: boolean;
    displayName?: string;
  }): Promise<SignedIn>;
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
  const securityLog = new InMemorySecurityLog();
  const mail = new InMemoryMailSender();
  const accounts = new InMemoryAccountRepository(sessions);
  const profiles = new InMemoryProfileLockPolicies(accounts.profiles);
  const profileRepository = new InMemoryProfileRepository(accounts.profiles, sessions);
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
  const links = new InMemoryLinkRepository(accounts);
  const wards = new InMemoryWardRepository(accounts, links);
  // PRO-12, PRO-15 : le double des profils consulte les règles de tutelle des comptes et des liens.
  profileRepository.guardianRules = wards;
  const transfers = new InMemoryTransferRepository(accounts, links, wards, sessions);
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
    .overrideProvider(ProfileRepository)
    .useValue(profileRepository)
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
    .overrideProvider(LinkRepository)
    .useValue(links)
    .overrideProvider(WardRepository)
    .useValue(wards)
    .overrideProvider(TransferRepository)
    .useValue(transfers)
    .compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  process.env = previousEnv;

  const identity: TestIdentity = {
    sessions,
    profiles,
    profileRepository,
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
    links,
    wards,
    transfers,
    async signIn({
      pin = false,
      relock = 'IDLE_15',
      withProfile = true,
      isChild = false,
      displayName,
    } = {}) {
      const accountId = randomUUID();
      const profileId = randomUUID();
      sessions.addAccount(accountId);
      if (withProfile) profiles.set({ profileId, accountId, hasPin: pin, relock });
      const created = accounts.profiles.get(profileId);
      if (created && withProfile) {
        accounts.profiles.set(profileId, {
          ...created,
          isChild,
          ...(displayName ? { displayName } : {}),
        });
      }
      return signIn(app, { accountId, profileId: withProfile ? profileId : null });
    },
  };
  return { app, exampleItems, identity };
}
