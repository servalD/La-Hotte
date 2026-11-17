// Réservé aux tests (contrat, intégration, non-fuite) : jetons d'injection des ports et doubles
// en mémoire. Aucun fichier de `src/` ne l'importe (la règle d'architecture le refuse).
export {
  AccountRepository,
  BackgroundTasks,
  IdentitySettings,
  PasswordBreachChecker,
  PasswordHasher,
} from './domain/account.ports';
export {
  EventThrottle,
  MailSender,
  ProfileLockPolicies,
  RateLimiter,
  SecurityLog,
  SecurityLogStore,
  SessionStore,
} from './domain/ports';
export {
  GoogleIdentityRepository,
  GoogleOidc,
  GoogleReauthProofs,
  OidcFlows,
} from './domain/google.ports';
export {
  FakeGoogleOidc,
  InMemoryGoogleIdentityRepository,
  InMemoryGoogleReauthProofs,
  InMemoryOidcFlows,
} from './infrastructure/in-memory-google';
export {
  PendingSecondFactors,
  SecondFactorRepository,
  TrustedDeviceRepository,
} from './domain/second-factor.ports';
export {
  FakePasswordHasher,
  InMemoryAccountRepository,
  InMemoryBackgroundTasks,
  InMemoryBreachChecker,
  InMemoryEventThrottle,
  InMemoryMailSender,
  InMemoryPendingSecondFactors,
  InMemorySecondFactorRepository,
  InMemoryTrustedDeviceRepository,
  InMemoryProfileLockPolicies,
  InMemoryProfileRepository,
  InMemoryRateLimiter,
  InMemorySecurityLog,
  InMemorySessionStore,
  StaticIdentitySettings,
  TEST_PIN,
  TEST_PIN_STAMP,
} from './infrastructure/in-memory';
export { ProfileRepository } from './domain/profile.ports';
export { CircleReader, LinkRepository } from './domain/link.ports';
export { InMemoryLinkRepository } from './infrastructure/in-memory-links';
export { WardRepository } from './domain/ward.ports';
export { InMemoryWardRepository } from './infrastructure/in-memory-wards';
export { TransferRepository } from './domain/transfer.ports';
export { InMemoryTransferRepository } from './infrastructure/in-memory-transfers';
export { AccountAdministration } from './domain/account-administration';
export { InMemoryAccountAdministration } from './infrastructure/in-memory-administration';
export { AccountLifecycle } from './domain/account-lifecycle';
export { InMemoryAccountLifecycle } from './infrastructure/in-memory-lifecycle';
export { EraseDueAccounts, HandleInactiveAccounts } from './application/contract';
