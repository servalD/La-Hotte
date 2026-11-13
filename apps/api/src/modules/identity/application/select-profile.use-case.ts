import { Injectable } from '@nestjs/common';
import { SecretTokens, type SessionRef } from '../domain/ports';
import { ProfileNotFoundError } from '../domain/profile.errors';
import { ProfileRepository } from '../domain/profile.ports';
import { SessionRequiredError } from '../domain/session.errors';
import type { ClientInfo } from './client-info';
import { PinVerifier } from './pin-verifier';
import { SessionLifecycle } from './session-lifecycle';

export interface ProfileSelection {
  readonly profileId: string;
  readonly unlocked: boolean;
  /** `EVERY_OPEN` : nonce à poser dans `__Host-lh_unlock` ; jamais journalisé. */
  readonly unlockNonce: string | null;
  /**
   * PIN-05 : PIN réinitialisé ou désactivé depuis l'espace Compte, rendu à **chaque** entrée tant
   * que le profil ne s'est pas redonné un PIN (PIN-04). `null` si le profil reste verrouillé.
   */
  readonly pinResetNoticeAt: Date | null;
  /** PIN-03 : PIN faux saisis depuis la dernière entrée ; `0` sans PIN ou s'il reste verrouillé. */
  readonly failedPinAttempts: number;
}

/**
 * `POST /session/profile` (PRO-07, API-11, PIN-02, PIN-07). Le profil choisi devient actif
 * **avant** la vérification du PIN : l'ancien est verrouillé et la ré-authentification effacée,
 * même si le PIN est faux. Sert aussi à redéverrouiller le profil actif après inactivité.
 */
@Injectable()
export class SelectProfile {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly lifecycle: SessionLifecycle,
    private readonly verifier: PinVerifier,
    private readonly tokens: SecretTokens,
  ) {}

  async execute(input: {
    readonly session: SessionRef;
    readonly profileId: string;
    readonly pin: string | null;
    readonly client: ClientInfo;
  }): Promise<ProfileSelection> {
    const { session, profileId } = input;
    const profile = await this.profiles.findDetails(session.accountId, profileId);
    // SEC-03, SEC-04 : un profil d'un autre compte est traité comme absent.
    if (!profile) throw new ProfileNotFoundError();

    await this.lifecycle.selectProfile(session, profileId);

    let unlockNonce: string | null = null;
    if (profile.hasPin || input.pin !== null) {
      if (input.pin === null) {
        return {
          profileId,
          unlocked: false,
          unlockNonce: null,
          pinResetNoticeAt: null,
          failedPinAttempts: 0,
        };
      }
      const check = await this.verifier.verify({
        accountId: session.accountId,
        profileId,
        pin: input.pin,
        client: input.client,
      });
      if (check.kind === 'verified') {
        unlockNonce = profile.pinRelock === 'EVERY_OPEN' ? this.tokens.generate() : null;
        if (!(await this.lifecycle.unlock(session, profileId, unlockNonce, check.pinStamp))) {
          throw new SessionRequiredError();
        }
      }
    }
    // PIN-03 : les PIN faux depuis la dernière entrée ne s'effacent qu'ici, à l'entrée qui les
    // montre (revue SEC-40, C2-M1 : ni un changement de PIN ni un réglage ne les perdent).
    const failedPinAttempts = await this.profiles.takeFailuresSinceEntry(
      session.accountId,
      profileId,
    );
    // PIN-05 : la notice n'est jamais effacée ici, pour que celui qui a réinitialisé ou désactivé
    // le PIN ne la fasse pas disparaître en entrant à la place du titulaire.
    return {
      profileId,
      unlocked: true,
      unlockNonce,
      pinResetNoticeAt: profile.pinResetNoticeAt,
      failedPinAttempts,
    };
  }
}

/**
 * `POST /session/lock` (PIN-07, ADR 0013) : verrouille le profil actif sans le changer et efface la
 * ré-authentification. Le client l'appelle au lancement de l'application.
 */
@Injectable()
export class LockSession {
  constructor(private readonly lifecycle: SessionLifecycle) {}

  async execute(session: SessionRef, activeProfileId: string | null): Promise<void> {
    await this.lifecycle.lock(session, activeProfileId);
  }
}
