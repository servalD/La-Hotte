// Ce que la présentation peut connaître du module (QA-03) : cas d'usage, ports servant de jetons
// d'injection, erreurs et règles nécessaires aux gardes.
export { CsrfTokens, SecretTokens, type SessionRef } from '../domain/ports';
export { hasRecentReauth, REAUTH_MAX_AGE_MS, REAUTH_PIN_MAX_AGE_MS } from '../domain/session';
export {
  CsrfRejectedError,
  ReauthRequiredError,
  SessionRequiredError,
} from '../domain/session.errors';
export {
  type ActiveProfile,
  AuthorizeProfile,
  type ProfileAccessState,
} from './authorize-profile.use-case';
export { CheckSessionAccess } from './check-session-access.use-case';
export { ReportCsrfRejection } from './report-csrf-rejection.use-case';
export { ResolveSession, type ResolvedSession, sessionRef } from './resolve-session.use-case';
export { type IssuedSession, SessionLifecycle } from './session-lifecycle';
