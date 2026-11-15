import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { ProfileLockPolicies, SessionStore } from '../domain/ports';
import { isProfileUnlocked, type ProfileLockPolicy } from '../domain/session';
import { ProfileLockedError } from '../domain/session.errors';
import type { ResolvedSession } from './resolve-session.use-case';

/** Profil actif d'une requête, déverrouillé. Seule source du profil pour les cas d'usage. */
export interface ActiveProfile {
  readonly id: string;
  readonly accountId: string;
}

export interface ProfileAccessInput {
  readonly session: ResolvedSession;
  /** Requête portant `X-User-Activity` : action explicite de l'utilisateur (API-21). */
  readonly userActivity: boolean;
  /** Valeur du cookie `__Host-lh_unlock` (`EVERY_OPEN`). */
  readonly unlockCookie: string | null;
}

export interface ProfileAccessState {
  readonly profileId: string | null;
  readonly unlocked: boolean;
}

/**
 * PIN-02, PIN-07 (ADR 0013, « Profil actif et PIN ») : le profil actif doit exister, appartenir
 * au compte de la session et être déverrouillé. Seules les actions de l'utilisateur prolongent le
 * déverrouillage.
 */
@Injectable()
export class AuthorizeProfile {
  constructor(
    private readonly policies: ProfileLockPolicies,
    private readonly store: SessionStore,
    private readonly clock: Clock,
  ) {}

  /** Refuse (`423 PROFILE_LOCKED`) sans profil actif déverrouillé. */
  async execute(input: ProfileAccessInput): Promise<ActiveProfile> {
    const { record, unlock } = input.session;
    const now = this.clock.now();
    const policy = await this.policyOf(input.session);
    if (!policy || !isProfileUnlocked({ policy, unlock, unlockCookie: input.unlockCookie, now })) {
      throw new ProfileLockedError();
    }
    if (input.userActivity && policy.hasPin && unlock && policy.relock !== 'NEVER') {
      // Compare-and-set : un verrouillage arrivé pendant cette requête n'est jamais annulé.
      await this.store.touchUnlock(record.tokenHash, unlock, now);
    }
    return { id: policy.profileId, accountId: record.accountId };
  }

  /** État sans effet de bord (`GET /session`) : ne prolonge jamais le déverrouillage. */
  async describe(input: Omit<ProfileAccessInput, 'userActivity'>): Promise<ProfileAccessState> {
    const policy = await this.policyOf(input.session);
    if (!policy) return { profileId: null, unlocked: false };
    const unlocked = isProfileUnlocked({
      policy,
      unlock: input.session.unlock,
      unlockCookie: input.unlockCookie,
      now: this.clock.now(),
    });
    return { profileId: policy.profileId, unlocked };
  }

  private async policyOf(session: ResolvedSession): Promise<ProfileLockPolicy | null> {
    const profileId = session.record.activeProfileId;
    if (!profileId) return null;
    return this.policies.find(session.record.accountId, profileId);
  }
}
