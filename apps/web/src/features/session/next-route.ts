import type { SessionStatusView } from '@wishlist/api-client';

/** Ce qu'un écran exige de la session : une session, ou une session avec un profil déverrouillé. */
export type Requirement = 'session' | 'profile';

/**
 * Où envoyer l'utilisateur pour que la session satisfasse l'exigence, ou `null` si elle la
 * satisfait. Le client n'applique aucune règle d'accès : il suit l'état que l'API lui rend (PIN-02).
 */
export function nextRoute(status: SessionStatusView, requires: Requirement): string | null {
  if (status.secondFactorPending) return '/auth/second-factor';
  if (!status.authenticated || !status.session) return '/auth/login';
  if (requires === 'session') return null;
  if (!status.session.activeProfileId) return '/profiles';
  if (!status.session.profileUnlocked) return '/profiles/unlock';
  return null;
}
