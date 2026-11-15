import type { DomainError } from '../../../shared/domain';
import type { RateLimiter } from '../domain/ports';
import { RateLimitedError } from '../domain/session.errors';

/**
 * Liens publics du profil (PRO-10, PRO-12, « Limitation ») : seuls les jetons qui échouent sont
 * comptés, par IP. Un jeton valable passe toujours, même seuil atteint : un proche derrière la même
 * adresse ne bloque pas le lien d'annulation du titulaire (revue SEC-40, cycle 2, I2). Lève
 * toujours : `429` au-delà du seuil, sinon `error`.
 */
export async function failToken(
  limiter: RateLimiter,
  ip: string,
  now: Date,
  error: DomainError,
): Promise<never> {
  const subjects = [{ scope: 'profile_link_ip' as const, parts: [ip] }];
  const check = await limiter.check(subjects, now);
  if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);
  await limiter.recordFailure(subjects, now, check.reservation);
  throw error;
}
