import { Injectable } from '@nestjs/common';
import { CacheKeys, ProfileLockPolicies } from '../domain/ports';
import { sameSecret } from '../domain/session';
import { ProfileLockedError } from '../domain/session.errors';
import type { ActiveProfile } from './authorize-profile.use-case';
import type { ResolvedSession } from './resolve-session.use-case';

export type CacheKeyResult =
  | { readonly encrypted: false }
  | { readonly encrypted: true; readonly keyId: string; readonly key: string };

/**
 * GET /profiles/me/cache-key (OFF-26, ADR 0020). Profil sans PIN : aucun chiffrement demandé.
 * Profil à PIN : clé dérivée de l'empreinte du PIN **qui a déverrouillé cette session** (PIN-05),
 * et seulement si c'est encore celle du PIN courant ; un déverrouillage d'avant un changement ou
 * une réinitialisation ne donne aucune clé.
 */
@Injectable()
export class GetCacheKey {
  constructor(
    private readonly policies: ProfileLockPolicies,
    private readonly keys: CacheKeys,
  ) {}

  async execute(session: ResolvedSession, profile: ActiveProfile): Promise<CacheKeyResult> {
    const policy = await this.policies.find(profile.accountId, profile.id);
    if (!policy) throw new ProfileLockedError();
    if (!policy.hasPin) return { encrypted: false };
    const unlock = session.unlock;
    if (
      !unlock ||
      unlock.profileId !== profile.id ||
      unlock.pinStamp === null ||
      policy.pinStamp === null ||
      !sameSecret(unlock.pinStamp, policy.pinStamp)
    ) {
      throw new ProfileLockedError();
    }
    const derived = this.keys.derive({
      profileId: profile.id,
      accountId: profile.accountId,
      pinStamp: policy.pinStamp,
    });
    return { encrypted: true, keyId: derived.keyId, key: derived.key };
  }
}
