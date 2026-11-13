// Réservé aux tests (contrat, intégration, non-fuite) : jetons d'injection des ports et doubles
// en mémoire. Aucun fichier de `src/` ne l'importe (la règle d'architecture le refuse).
export {
  EventThrottle,
  MailSender,
  ProfileLockPolicies,
  RateLimiter,
  SecurityLog,
  SessionStore,
} from './domain/ports';
export {
  InMemoryEventThrottle,
  InMemoryMailSender,
  InMemoryProfileLockPolicies,
  InMemoryRateLimiter,
  InMemorySecurityLog,
  InMemorySessionStore,
} from './infrastructure/in-memory';
