import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { DISPLAY_NAME_MAX_LENGTH } from '../domain/account';
import { PasswordHasher } from '../domain/account.ports';
import { SecretTokens, SecurityLog, type SessionRef } from '../domain/ports';
import {
  isBirthdayValid,
  isPinWellFormed,
  isTimezoneValid,
  normalizeDisplayName,
  type ProfileChanges,
  type ProfileDetails,
  weakensRelock,
} from '../domain/profile';
import {
  CurrentPinRequiredError,
  InvalidProfileError,
  PinInvalidError,
  ProfileNotFoundError,
  ProfileVersionMismatchError,
} from '../domain/profile.errors';
import { ProfileRepository } from '../domain/profile.ports';
import { SessionRequiredError } from '../domain/session.errors';
import type { ActiveProfile } from './authorize-profile.use-case';
import type { ClientInfo } from './client-info';
import { PinVerifier } from './pin-verifier';
import { SessionLifecycle } from './session-lifecycle';

/** `GET /profiles/me` : le profil actif, déverrouillé (PRO-02). */
@Injectable()
export class GetOwnProfile {
  constructor(private readonly profiles: ProfileRepository) {}

  async execute(profile: ActiveProfile): Promise<ProfileDetails> {
    const details = await this.profiles.findDetails(profile.accountId, profile.id);
    if (!details) throw new ProfileNotFoundError();
    return details;
  }
}

/**
 * `PATCH /profiles/me` (PRO-03, API-17) : champs du profil actif, si sa version est celle que le
 * client a lue. Le marqueur enfant n'en fait pas partie. Passer à `EVERY_OPEN` verrouille la
 * session courante à la requête suivante (son déverrouillage n'a pas de nonce) : le PIN est
 * redemandé, comme à une ouverture. Affaiblir le reverrouillage d'un profil à PIN exige le PIN
 * courant, compté par PIN-03 : une session trouvée déverrouillée ne se rend pas permanente.
 */
@Injectable()
export class UpdateOwnProfile {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly verifier: PinVerifier,
  ) {}

  async execute(input: {
    readonly profile: ActiveProfile;
    readonly expectedVersion: number;
    readonly changes: ProfileChanges;
    readonly currentPin: string | null;
    readonly client: ClientInfo;
  }): Promise<ProfileDetails> {
    const changes = validateChanges(input.changes);
    if (changes.pinRelock !== undefined) {
      const current = await this.profiles.findDetails(input.profile.accountId, input.profile.id);
      if (!current) throw new ProfileNotFoundError();
      if (current.hasPin && weakensRelock(current.pinRelock, changes.pinRelock)) {
        if (input.currentPin === null) throw new CurrentPinRequiredError();
        await this.verifier.verify({
          accountId: input.profile.accountId,
          profileId: input.profile.id,
          pin: input.currentPin,
          client: input.client,
        });
      }
    }
    const result = await this.profiles.update(
      input.profile.accountId,
      input.profile.id,
      input.expectedVersion,
      changes,
    );
    if (result.status === 'updated') return result.profile;
    if (result.status === 'stale') throw new ProfileVersionMismatchError();
    throw new ProfileNotFoundError();
  }
}

/** Contrôles du domaine que la validation des DTO ne peut pas faire (dates, fuseau). */
function validateChanges(changes: ProfileChanges): ProfileChanges {
  const out: { -readonly [K in keyof ProfileChanges]: ProfileChanges[K] } = { ...changes };
  if (changes.displayName !== undefined) {
    const name = normalizeDisplayName(changes.displayName);
    if (name.length === 0 || name.length > DISPLAY_NAME_MAX_LENGTH) throw new InvalidProfileError();
    out.displayName = name;
  }
  if (changes.birthday) {
    const { day, month, year } = changes.birthday;
    if (!isBirthdayValid(day, month, year)) throw new InvalidProfileError();
  }
  if (changes.timezone !== undefined && !isTimezoneValid(changes.timezone)) {
    throw new InvalidProfileError();
  }
  return out;
}

/**
 * `PUT /profiles/me/pin` (PIN-04). Un profil sans PIN s'en donne un ; un profil qui en a un le
 * change avec l'ancien, compté comme tout essai (PIN-03), sans ré-authentification du compte.
 * Jamais de désactivation ici (PIN-05). La session qui le fait reste déverrouillée ; les autres
 * sessions où ce profil est actif sont verrouillées.
 */
@Injectable()
export class SetOwnPin {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly verifier: PinVerifier,
    private readonly hasher: PasswordHasher,
    private readonly lifecycle: SessionLifecycle,
    private readonly tokens: SecretTokens,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  /** Renvoie le nonce de déverrouillage à poser (`EVERY_OPEN`), ou `null`. */
  async execute(input: {
    readonly session: SessionRef;
    readonly profile: ActiveProfile;
    readonly currentPin: string | null;
    readonly newPin: string;
    readonly client: ClientInfo;
  }): Promise<{ readonly unlockNonce: string | null }> {
    const { accountId, id: profileId } = input.profile;
    if (!isPinWellFormed(input.newPin)) throw new InvalidProfileError();
    const details = await this.profiles.findDetails(accountId, profileId);
    if (!details) throw new ProfileNotFoundError();

    let expectedHash: string | null = null;
    if (details.hasPin) {
      if (input.currentPin === null) throw new CurrentPinRequiredError();
      const check = await this.verifier.verify({
        accountId,
        profileId,
        pin: input.currentPin,
        client: input.client,
      });
      // PIN désactivé entre-temps depuis l'espace Compte : on repart d'un profil sans PIN.
      expectedHash = check.kind === 'verified' ? check.pinHash : null;
    }

    const pinHash = await this.hasher.hash(input.newPin);
    // PIN-05 : le profil se redonne lui-même un PIN, la notice de réinitialisation s'efface.
    const written = await this.profiles.setPin({
      accountId,
      profileId,
      pinHash,
      expectedHash,
      resetNoticeAt: null,
    });
    // Le PIN a changé pendant la requête (autre onglet, espace Compte) : rien n'est écrit.
    if (!written?.pinStamp) {
      throw details.hasPin ? new PinInvalidError() : new CurrentPinRequiredError();
    }

    // Les déverrouillages donnés par l'ancien PIN ne valent déjà plus (empreinte) ; les autres
    // sessions sont aussi verrouillées explicitement, pour publier l'événement.
    await this.lifecycle.lockProfileEverywhere(accountId, profileId, input.session.id);
    const unlockNonce = details.pinRelock === 'EVERY_OPEN' ? this.tokens.generate() : null;
    // Empreinte calculée par l'adaptateur, la même que lit la garde (revue SEC-40, C2-M2).
    if (!(await this.lifecycle.unlock(input.session, profileId, unlockNonce, written.pinStamp))) {
      throw new SessionRequiredError();
    }
    await this.securityLog.record({
      accountId,
      event: 'pin.changed',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: this.clock.now(),
    });
    return { unlockNonce };
  }
}
