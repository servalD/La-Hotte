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
  SessionStore,
} from './domain/ports';
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
  InMemoryRateLimiter,
  InMemorySecurityLog,
  InMemorySessionStore,
  StaticIdentitySettings,
} from './infrastructure/in-memory';
