import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import {
  accentColorFor,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  DISPLAY_NAME_MAX_LENGTH,
  normalizeEmail,
  tokenExpiry,
} from '../domain/account';
import { AccountRepository, BackgroundTasks } from '../domain/account.ports';
import {
  IdentityEvents,
  RateLimiter,
  SecretTokens,
  type SecurityEvent,
  SecurityLog,
} from '../domain/ports';
import { normalizeDisplayName } from '../domain/profile';
import { InvalidProfileError, ProfileLimitReachedError } from '../domain/profile.errors';
import { EmailNotVerifiedError } from '../domain/second-factor.errors';
import type { SessionRecord } from '../domain/session';
import { RateLimitedError, SessionRequiredError } from '../domain/session.errors';
import { ACCOUNT_SETUP_TTL_MS, TRANSFER_TTL_MS } from '../domain/transfer';
import type { WardSummary } from '../domain/ward';
import {
  AccountSetupInvalidError,
  WardChildOnlyError,
  WardNotFoundError,
  WardReleaseNotRequestedError,
  WardReleaseSingleProfileError,
} from '../domain/ward.errors';
import { WardRepository } from '../domain/ward.ports';
import { AccountMailer, type GuardianAction } from './account-mailer';
import type { ClientInfo } from './client-info';
import { PasswordPolicy } from './password-policy';
import { RemoveUnverifiedAccount } from './remove-unverified-account';
import { SessionLifecycle } from './session-lifecycle';

/** PRO-16 : chaque action est écrite au journal des deux comptes, tuteur et sous tutelle. */
async function logBoth(
  securityLog: SecurityLog,
  accounts: readonly string[],
  event: SecurityEvent,
  client: ClientInfo,
  at: Date,
): Promise<void> {
  for (const accountId of accounts) {
    await securityLog.record({ accountId, event, ip: client.ip, userAgent: client.userAgent, at });
  }
}

/** PRO-16, SEC-04 : un compte sous tutelle d'un autre tuteur est traité comme absent. */
async function ownedWard(
  wards: WardRepository,
  guardianAccountId: string,
  wardAccountId: string,
): Promise<WardSummary> {
  const ward = await wards.findWard(guardianAccountId, wardAccountId);
  if (!ward) throw new WardNotFoundError();
  return ward;
}

/** Avis au compte sous tutelle d'une action de son tuteur (PRO-16), en tâche de fond. */
function noticeWard(
  background: BackgroundTasks,
  mailer: AccountMailer,
  to: string,
  action: GuardianAction,
): void {
  background.run('ward.notice', async () => {
    await mailer.send(to, { kind: 'guardian_action', action });
  });
}

/**
 * PRO-15 : création d'un compte sous tutelle avec un nouveau profil enfant, depuis l'espace Compte
 * du tuteur, après ré-authentification (route). Le tuteur déclare l'autorité parentale (le DTO
 * n'accepte que `true`). Anti-énumération (AUTH-09) : la réponse ne dépend pas de l'adresse ; si
 * elle a déjà un compte, aucun lien ne part et son titulaire est averti.
 */
@Injectable()
export class CreateWard {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly wards: WardRepository,
    private readonly tokens: SecretTokens,
    private readonly limiter: RateLimiter,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly guardianAccountId: string;
    readonly email: string;
    readonly profileName: string;
    readonly guardianAttested: true;
    readonly client: ClientInfo;
  }): Promise<void> {
    const guardian = await this.accounts.findById(input.guardianAccountId);
    if (!guardian) throw new SessionRequiredError();
    if (!guardian.emailVerified) throw new EmailNotVerifiedError();
    // PRO-15 : pas de chaîne de tutelle.
    if (await this.wards.guardianshipOf(input.guardianAccountId)) throw new WardChildOnlyError();
    const profileName = normalizeDisplayName(input.profileName);
    if (profileName.length === 0 || profileName.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new InvalidProfileError();
    }

    const now = this.clock.now();
    const subjects = [{ scope: 'transfer_request' as const, parts: [input.guardianAccountId] }];
    const check = await this.limiter.check(subjects, now);
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);
    await this.limiter.recordFailure(subjects, now, check.reservation);

    const email = normalizeEmail(input.email);
    const token = this.tokens.generate();
    const transferId = this.ids.next();
    await this.wards.createSetupRequest({
      id: transferId,
      guardianAccountId: input.guardianAccountId,
      email,
      profileName,
      tokenHash: this.tokens.hash(token),
      now,
      tokenExpiresAt: new Date(now.getTime() + ACCOUNT_SETUP_TTL_MS),
      expiresAt: new Date(now.getTime() + TRANSFER_TTL_MS),
    });
    await this.securityLog.record({
      accountId: input.guardianAccountId,
      transferId,
      event: 'ward.setup_requested',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: now,
    });
    // Après la réponse : l'état de l'adresse ne change ni la forme ni la durée de la réponse.
    this.background.run('ward.setup_mail', async () => {
      const existing = await this.accounts.findByEmail(email);
      // Un compte non vérifié sera remplacé à l'installation (AUTH-15) : le lien part.
      const taken =
        (existing !== null && existing.emailVerified) ||
        (await this.accounts.isEmailReserved(email, null, this.clock.now()));
      if (taken) {
        await this.mailer.send(email, { kind: 'email_taken_notice' });
        return;
      }
      await this.mailer.send(email, { kind: 'ward_setup', token });
    });
  }
}

/**
 * PRO-15 : installation d'un compte sous tutelle par son lien (route publique, jeton dans le
 * corps). Qui l'ouvre fixe le mot de passe ; le compte naît vérifié, sans déclaration d'âge.
 * Aucune session n'est ouverte : on se connecte ensuite. Un seul refus pour un lien inutilisable
 * ou une adresse déjà inscrite (AUTH-09) ; un compte **non vérifié** de même adresse est remplacé
 * (AUTH-15 : le lien prouve la boîte).
 */
@Injectable()
export class SetupWardAccount {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly wards: WardRepository,
    private readonly passwords: PasswordPolicy,
    private readonly tokens: SecretTokens,
    private readonly limiter: RateLimiter,
    private readonly removeUnverified: RemoveUnverifiedAccount,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly token: string;
    readonly password: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const now = this.clock.now();
    const subjects = [{ scope: 'account_setup_ip' as const, parts: [input.client.ip] }];
    const check = await this.limiter.check(subjects, now);
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);
    await this.limiter.recordFailure(subjects, now, check.reservation);
    if (!this.tokens.isWellFormed(input.token)) throw new AccountSetupInvalidError();

    const tokenHash = this.tokens.hash(input.token);
    const setup = await this.wards.findOpenSetup(tokenHash, now);
    if (!setup) throw new AccountSetupInvalidError();
    // AUTH-02 : mêmes règles qu'à l'inscription (longueur, fuites connues).
    const passwordHash = await this.passwords.hashNew(input.password);

    const existing = await this.accounts.findByEmail(setup.email);
    if (existing && !existing.emailVerified)
      await this.removeUnverified.execute(existing.accountId);

    const accountId = this.ids.next();
    const profileId = this.ids.next();
    const result = await this.wards.completeSetup({
      tokenHash,
      accountId,
      passwordHash,
      profile: {
        id: profileId,
        displayName: setup.profileName,
        accentColor: accentColorFor(profileId),
        locale: DEFAULT_LOCALE,
        currency: DEFAULT_CURRENCY,
        timezone: DEFAULT_TIMEZONE,
      },
      linkIds: () => this.ids.next(),
      now: this.clock.now(),
    });
    if (result.status !== 'created') {
      if (result.status === 'email_taken') {
        this.background.run('ward.setup_taken', async () => {
          await this.mailer.send(setup.email, { kind: 'email_taken_notice' });
        });
      }
      throw new AccountSetupInvalidError();
    }
    await logBoth(
      this.securityLog,
      [result.guardianAccountId, accountId],
      'ward.created',
      input.client,
      now,
    );
  }
}

/** PRO-16 : comptes sous la tutelle du compte, métadonnées seulement (PIN-08). */
@Injectable()
export class ListWards {
  constructor(private readonly wards: WardRepository) {}

  async execute(guardianAccountId: string): Promise<WardSummary[]> {
    return this.wards.listWards(guardianAccountId);
  }
}

/** PRO-16 : un compte sous tutelle et ses sessions (appareil, dernière activité). */
@Injectable()
export class GetWard {
  constructor(
    private readonly wards: WardRepository,
    private readonly lifecycle: SessionLifecycle,
  ) {}

  async execute(input: {
    readonly guardianAccountId: string;
    readonly wardAccountId: string;
  }): Promise<{ readonly ward: WardSummary; readonly sessions: readonly SessionRecord[] }> {
    const ward = await ownedWard(this.wards, input.guardianAccountId, input.wardAccountId);
    return { ward, sessions: await this.lifecycle.list(ward.id) };
  }
}

/** PRO-16 : déconnexion de tous les appareils du compte sous tutelle. */
@Injectable()
export class RevokeWardSessions {
  constructor(
    private readonly wards: WardRepository,
    private readonly lifecycle: SessionLifecycle,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly guardianAccountId: string;
    readonly wardAccountId: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const ward = await ownedWard(this.wards, input.guardianAccountId, input.wardAccountId);
    await this.lifecycle.revokeAll(ward.id);
    const now = this.clock.now();
    await logBoth(
      this.securityLog,
      [input.guardianAccountId, ward.id],
      'ward.sessions_revoked',
      input.client,
      now,
    );
    noticeWard(this.background, this.mailer, ward.email, 'sessions_revoked');
  }
}

/**
 * PRO-16 : réinitialisation du mot de passe du compte sous tutelle, par un lien envoyé à
 * **l'adresse du tuteur** ; elle suit ensuite AUTH-06 (toutes les sessions révoquées). Un
 * changement d'adresse du compte sous tutelle ne prive donc pas le tuteur de ce pouvoir.
 */
@Injectable()
export class ResetWardPassword {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly wards: WardRepository,
    private readonly tokens: SecretTokens,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly guardianAccountId: string;
    readonly wardAccountId: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const ward = await ownedWard(this.wards, input.guardianAccountId, input.wardAccountId);
    const guardian = await this.accounts.findById(input.guardianAccountId);
    if (!guardian) throw new SessionRequiredError();
    const now = this.clock.now();
    const token = this.tokens.generate();
    await this.accounts.issueToken({
      id: this.ids.next(),
      accountId: ward.id,
      purpose: 'PASSWORD_RESET',
      tokenHash: this.tokens.hash(token),
      newEmail: null,
      createdAt: now,
      expiresAt: tokenExpiry('PASSWORD_RESET', now),
    });
    await logBoth(
      this.securityLog,
      [input.guardianAccountId, ward.id],
      'ward.password_reset',
      input.client,
      now,
    );
    this.background.run('ward.password_reset_mail', async () => {
      await this.mailer.send(guardian.email, { kind: 'ward_password_reset', token });
    });
    noticeWard(this.background, this.mailer, ward.email, 'password_reset');
  }
}

/** PRO-16 : nouveau profil enfant dans le compte sous tutelle, lié d'office au tuteur. */
@Injectable()
export class CreateWardProfile {
  constructor(
    private readonly wards: WardRepository,
    private readonly events: IdentityEvents,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly guardianAccountId: string;
    readonly wardAccountId: string;
    readonly displayName: string;
    readonly client: ClientInfo;
  }): Promise<{ readonly profileId: string }> {
    const ward = await ownedWard(this.wards, input.guardianAccountId, input.wardAccountId);
    const displayName = normalizeDisplayName(input.displayName);
    if (displayName.length === 0 || displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new InvalidProfileError();
    }
    const profileId = this.ids.next();
    const now = this.clock.now();
    const created = await this.wards.createWardProfile({
      wardAccountId: ward.id,
      profile: {
        id: profileId,
        displayName,
        accentColor: accentColorFor(profileId),
        locale: DEFAULT_LOCALE,
        currency: DEFAULT_CURRENCY,
        timezone: DEFAULT_TIMEZONE,
      },
      linkIds: () => this.ids.next(),
      now,
    });
    if (created === 'missing') throw new WardNotFoundError();
    if (created === 'limit') throw new ProfileLimitReachedError();
    await logBoth(
      this.securityLog,
      [input.guardianAccountId, ward.id],
      'ward.profile_created',
      input.client,
      now,
    );
    // LNK-09, LNK-11 : le profil naît avec ses liens vers le compte tuteur.
    this.events.publish({ type: 'circle.changed', profileIds: [profileId] });
    noticeWard(this.background, this.mailer, ward.email, 'profile_created');
    return { profileId };
  }
}

/** PRO-16 : levée de la tutelle demandée, effective à la déclaration d'âge du compte. */
@Injectable()
export class RequestWardRelease {
  constructor(
    private readonly wards: WardRepository,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly guardianAccountId: string;
    readonly wardAccountId: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const ward = await ownedWard(this.wards, input.guardianAccountId, input.wardAccountId);
    const now = this.clock.now();
    const result = await this.wards.requestRelease(input.guardianAccountId, ward.id, now);
    if (result === 'missing') throw new WardNotFoundError();
    if (result === 'multiple_profiles') throw new WardReleaseSingleProfileError();
    await logBoth(
      this.securityLog,
      [input.guardianAccountId, ward.id],
      'ward.release_requested',
      input.client,
      now,
    );
    noticeWard(this.background, this.mailer, ward.email, 'release_requested');
  }
}

/**
 * PRO-16, AUTH-08 : déclaration d'âge du compte sous tutelle (case non précochée, le DTO n'accepte
 * que `true`), qui fait effet à la levée demandée par le tuteur. Le profil perd le marqueur enfant
 * et en voit la notice ; les jetons émis par le tuteur sont désarmés.
 */
@Injectable()
export class AttestAgeForRelease {
  constructor(
    private readonly wards: WardRepository,
    private readonly events: IdentityEvents,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly ageAttested: true;
    readonly client: ClientInfo;
  }): Promise<void> {
    const now = this.clock.now();
    const result = await this.wards.attestAgeAndRelease(input.accountId, now);
    if (result.status !== 'released') {
      throw result.status === 'not_requested'
        ? new WardReleaseNotRequestedError()
        : new WardReleaseSingleProfileError();
    }
    await logBoth(
      this.securityLog,
      [result.guardianAccountId, input.accountId],
      'ward.released',
      input.client,
      now,
    );
    // LNK-09 : le profil n'est plus enfant ; son nom et sa tutelle changent pour ses contreparties.
    this.events.publish({ type: 'circle.changed', profileIds: [result.profileId] });
  }
}
