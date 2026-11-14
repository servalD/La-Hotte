import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { ProfileLockPolicies, SessionStore } from '../domain/ports';
import { isProfileUnlocked, rejectSession } from '../domain/session';

/**
 * `checkSessionAccess(sessionId, profileId)` (ADR 0013) : la passerelle temps réel (phase 4)
 * revérifie à chaque émission que la session vit encore, que ce profil est toujours son profil
 * actif et qu'il est déverrouillé ; l'expiration passive du déverrouillage n'émet aucun événement.
 * Le cookie `EVERY_OPEN` n'est pas visible d'une socket : seule la durée d'inactivité compte.
 */
@Injectable()
export class CheckSessionAccess {
  constructor(
    private readonly store: SessionStore,
    private readonly policies: ProfileLockPolicies,
    private readonly clock: Clock,
  ) {}

  async execute(sessionId: string, profileId: string): Promise<boolean> {
    const found = await this.store.findById(sessionId);
    if (!found) return false;
    const now = this.clock.now();
    if (rejectSession(found.record, found.accountEpoch, now)) return false;
    if (found.record.activeProfileId !== profileId) return false;
    const policy = await this.policies.find(found.record.accountId, profileId);
    if (!policy) return false;
    // Socket : pas de cookie ; `EVERY_OPEN` y est traité comme `IDLE_15`.
    const effective =
      policy.relock === 'EVERY_OPEN' ? { ...policy, relock: 'IDLE_15' as const } : policy;
    return isProfileUnlocked({ policy: effective, unlock: found.unlock, unlockCookie: null, now });
  }
}
