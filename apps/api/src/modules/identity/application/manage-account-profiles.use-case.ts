import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import {
  accentColorFor,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  DISPLAY_NAME_MAX_LENGTH,
} from '../domain/account';
import { AccountRepository, PasswordHasher } from '../domain/account.ports';
import { type SecurityEvent, SecurityLog, type SessionRef } from '../domain/ports';
import { isPinWellFormed, normalizeDisplayName, type ProfileMetadata } from '../domain/profile';
import {
  InvalidProfileError,
  LastProfileError,
  PinNotSetError,
  ProfileLimitReachedError,
  ProfileNotFoundError,
} from '../domain/profile.errors';
import { ProfileRepository } from '../domain/profile.ports';
import { EmailNotVerifiedError } from '../domain/second-factor.errors';
import { SessionRequiredError } from '../domain/session.errors';
import type { ClientInfo } from './client-info';
import { SessionLifecycle } from './session-lifecycle';

/**
 * Profils dans l'espace Compte (PIN-08, PRO-08) : **métadonnées seulement** (identifiant, nom,
 * avatar, présence d'un PIN, marqueur enfant). Rien de ce qu'un profil protège par son PIN.
 */
@Injectable()
export class ListAccountProfiles {
  constructor(private readonly profiles: ProfileRepository) {}

  async execute(accountId: string): Promise<ProfileMetadata[]> {
    return this.profiles.listMetadata(accountId);
  }
}

/** PRO-08 : création, sans ré-authentification, 10 au plus, compte vérifié (AUTH-15). */
@Injectable()
export class CreateAccountProfile {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly profiles: ProfileRepository,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly displayName: string;
    readonly isChild: boolean;
    readonly client: ClientInfo;
  }): Promise<ProfileMetadata> {
    const account = await this.accounts.findById(input.accountId);
    if (!account) throw new SessionRequiredError();
    if (!account.emailVerified) throw new EmailNotVerifiedError();
    const displayName = normalizeDisplayName(input.displayName);
    if (displayName.length === 0 || displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new InvalidProfileError();
    }

    const id = this.ids.next();
    const now = this.clock.now();
    const created = await this.profiles.create(
      input.accountId,
      {
        id,
        displayName,
        accentColor: accentColorFor(id),
        locale: DEFAULT_LOCALE,
        currency: DEFAULT_CURRENCY,
        timezone: DEFAULT_TIMEZONE,
        isChild: input.isChild,
      },
      now,
    );
    if (created === 'limit') throw new ProfileLimitReachedError();
    await log(this.securityLog, input.accountId, 'profile.created', input.client, now);
    return {
      id,
      displayName,
      avatar: null,
      accentColor: accentColorFor(id),
      hasPin: false,
      isChild: input.isChild,
    };
  }
}

/**
 * PRO-08 (AUTH-14, ré-authentification exigée par la route) : suppression d'un profil du compte,
 * jamais du dernier. Les sessions où il était actif reviennent à l'écran de sélection.
 */
@Injectable()
export class DeleteAccountProfile {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly lifecycle: SessionLifecycle,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly session: SessionRef;
    readonly profileId: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const accountId = input.session.accountId;
    // Lues avant : après la suppression, `SET NULL` a effacé le profil actif des lignes.
    const sessions = await this.lifecycle.sessionsWithProfile(accountId, input.profileId);
    const result = await this.profiles.delete(accountId, input.profileId);
    if (result === 'missing') throw new ProfileNotFoundError();
    if (result === 'last') throw new LastProfileError();
    // Après la suppression : les événements de changement de profil suivent l'écriture (salons
    // temps réel). Une session qui l'aurait choisi entre les deux n'y trouve plus qu'un profil
    // absent, donc verrouillé (423).
    await this.lifecycle.deselect(sessions);
    await log(this.securityLog, accountId, 'profile.deleted', input.client, this.clock.now());
  }
}

/**
 * PIN-05 : réinitialisation (nouveau PIN fixé par le compte), après une ré-authentification de
 * moins de 2 minutes. Le profil est verrouillé dans toutes les sessions où il est actif, celle de
 * l'appelant comprise, et sera prévenu à sa prochaine entrée.
 */
@Injectable()
export class ResetProfilePin {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly hasher: PasswordHasher,
    private readonly lifecycle: SessionLifecycle,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly session: SessionRef;
    readonly profileId: string;
    readonly newPin: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const accountId = input.session.accountId;
    if (!isPinWellFormed(input.newPin)) throw new InvalidProfileError();
    const profile = await this.profiles.findDetails(accountId, input.profileId);
    if (!profile) throw new ProfileNotFoundError();
    if (!profile.hasPin) throw new PinNotSetError();

    const now = this.clock.now();
    const written = await this.profiles.setPin({
      accountId,
      profileId: input.profileId,
      pinHash: await this.hasher.hash(input.newPin),
      resetNoticeAt: now,
    });
    if (!written) throw new ProfileNotFoundError();
    await this.lifecycle.lockProfileEverywhere(accountId, input.profileId, null);
    await log(this.securityLog, accountId, 'pin.reset', input.client, now);
  }
}

/**
 * PIN-05 : désactivation du PIN, seulement ici, après une ré-authentification de moins de
 * 2 minutes. Le profil sera prévenu à sa prochaine entrée.
 */
@Injectable()
export class DisableProfilePin {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly session: SessionRef;
    readonly profileId: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const accountId = input.session.accountId;
    const profile = await this.profiles.findDetails(accountId, input.profileId);
    if (!profile) throw new ProfileNotFoundError();
    if (!profile.hasPin) throw new PinNotSetError();
    const now = this.clock.now();
    const written = await this.profiles.setPin({
      accountId,
      profileId: input.profileId,
      pinHash: null,
      resetNoticeAt: now,
    });
    if (!written) throw new ProfileNotFoundError();
    await log(this.securityLog, accountId, 'pin.disabled', input.client, now);
  }
}

async function log(
  securityLog: SecurityLog,
  accountId: string,
  event: SecurityEvent,
  client: ClientInfo,
  at: Date,
): Promise<void> {
  await securityLog.record({ accountId, event, ip: client.ip, userAgent: client.userAgent, at });
}
