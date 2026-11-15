import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import {
  accentColorFor,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  DISPLAY_NAME_MAX_LENGTH,
  normalizeEmail,
} from '../domain/account';
import { AccountMailer } from './account-mailer';
import { BackgroundTasks, PasswordHasher } from '../domain/account.ports';
import type { ProfileProposal } from '../domain/link';
import {
  ChildEmailForbiddenError,
  InvitationInvalidError,
  ProfileProposalPendingError,
} from '../domain/link.errors';
import { LinkRepository } from '../domain/link.ports';
import {
  IdentityEvents,
  RateLimiter,
  SecretTokens,
  type SecurityEvent,
  SecurityLog,
} from '../domain/ports';
import { isPinWellFormed, normalizeDisplayName } from '../domain/profile';
import { InvalidProfileError, ProfileLimitReachedError } from '../domain/profile.errors';
import { ProfileRepository } from '../domain/profile.ports';
import { RateLimitedError } from '../domain/session.errors';
import { PROFILE_EMAIL_VERIFY_TTL_MS } from '../domain/transfer';
import type { ClientInfo } from './client-info';

async function log(
  securityLog: SecurityLog,
  accountId: string,
  event: SecurityEvent,
  client: ClientInfo,
  at: Date,
): Promise<void> {
  await securityLog.record({ accountId, event, ip: client.ip, userAgent: client.userAgent, at });
}

/**
 * PRO-11 : propositions de profil reçues par l'espace Compte. Ne montre que le nom de l'invitant
 * et le marqueur enfant. Limite assumée (PIN-08) : quiconque a les identifiants du compte apprend
 * ainsi que l'invitant est lié à l'un de ses profils.
 */
@Injectable()
export class ListProfileProposals {
  constructor(
    private readonly links: LinkRepository,
    private readonly clock: Clock,
  ) {}

  async execute(accountId: string): Promise<ProfileProposal[]> {
    return this.links.listProfileProposals(accountId, this.clock.now());
  }
}

/**
 * PRO-11 : acceptation (ré-authentification exigée par la route) ou refus d'une proposition par le
 * compte visé. À l'acceptation, le lien avec l'invitant et l'absence de blocage sont revérifiés :
 * perdus, la proposition est révoquée comme refusée, et l'appelant reçoit le refus commun.
 */
@Injectable()
export class DecideProfileProposal {
  constructor(
    private readonly links: LinkRepository,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly invitationId: string;
    readonly accept: boolean;
    readonly client: ClientInfo;
  }): Promise<void> {
    const now = this.clock.now();
    const result = await this.links.decideProfileProposal({
      invitationId: input.invitationId,
      accountId: input.accountId,
      accept: input.accept,
      now,
    });
    if (result === 'missing') throw new InvitationInvalidError();
    await log(
      this.securityLog,
      input.accountId,
      result === 'accepted' ? 'profile_proposal.accepted' : 'profile_proposal.refused',
      input.client,
      now,
    );
    if (result === 'revoked') throw new InvitationInvalidError();
  }
}

export interface ProfileInvitationPreview {
  /** L'invitant n'est jamais un enfant (PRO-11) : son nom est toujours rendu. */
  readonly inviterName: string;
  readonly profileIsChild: boolean;
  readonly expiresAt: Date;
}

function checkIp(limiter: RateLimiter, ip: string, now: Date) {
  return limiter.check([{ scope: 'profile_invitation_ip' as const, parts: [ip] }], now);
}

/**
 * PRO-11 : ce que voit la personne invitée, sans session. Le nom de l'invitant est rendu sans
 * session, à la différence de LNK-07 : l'invitant n'est jamais un enfant, et la personne invitée
 * n'a pas encore de compte. Limité par adresse IP.
 */
@Injectable()
export class InspectProfileInvitation {
  constructor(
    private readonly links: LinkRepository,
    private readonly tokens: SecretTokens,
    private readonly limiter: RateLimiter,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly token: string;
    readonly client: ClientInfo;
  }): Promise<ProfileInvitationPreview> {
    const now = this.clock.now();
    const subjects = [{ scope: 'profile_invitation_ip' as const, parts: [input.client.ip] }];
    const check = await checkIp(this.limiter, input.client.ip, now);
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);
    await this.limiter.recordFailure(subjects, now, check.reservation);
    const found = await this.links.findProfileInvitation(this.tokens.hash(input.token), now);
    if (!found || found.inviter.isChild) throw new InvitationInvalidError();
    if (!found.accepted) throw new ProfileProposalPendingError();
    return {
      inviterName: found.inviter.displayName,
      profileIsChild: found.profileIsChild,
      expiresAt: found.expiresAt,
    };
  }
}

/**
 * PRO-11 : la personne invitée donne son accord et crée son profil, sans session. Elle peut fixer
 * tout de suite un PIN (PIN-01) et une adresse (PRO-10, vérifiée ensuite par un lien). L'accès
 * suit hors de l'application : le titulaire du compte transmet ses identifiants. Aucune session
 * n'est ouverte.
 */
@Injectable()
export class AcceptProfileInvitation {
  constructor(
    private readonly links: LinkRepository,
    private readonly profiles: ProfileRepository,
    private readonly tokens: SecretTokens,
    private readonly limiter: RateLimiter,
    private readonly hasher: PasswordHasher,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly events: IdentityEvents,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly token: string;
    readonly displayName: string;
    readonly pin?: string;
    readonly email?: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const now = this.clock.now();
    const subjects = [{ scope: 'profile_invitation_ip' as const, parts: [input.client.ip] }];
    const check = await checkIp(this.limiter, input.client.ip, now);
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);
    await this.limiter.recordFailure(subjects, now, check.reservation);

    const displayName = normalizeDisplayName(input.displayName);
    if (displayName.length === 0 || displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new InvalidProfileError();
    }
    if (input.pin !== undefined && !isPinWellFormed(input.pin)) throw new InvalidProfileError();
    const tokenHash = this.tokens.hash(input.token);
    const found = await this.links.findProfileInvitation(tokenHash, now);
    if (!found) throw new InvitationInvalidError();
    if (!found.accepted) throw new ProfileProposalPendingError();
    // PRO-10 : un profil enfant n'a pas d'adresse.
    if (input.email && found.profileIsChild) throw new ChildEmailForbiddenError();

    const pinHash = input.pin !== undefined ? await this.hasher.hash(input.pin) : null;
    const profileId = this.ids.next();
    const result = await this.links.redeemProfileInvitation({
      tokenHash,
      profile: {
        id: profileId,
        displayName,
        accentColor: accentColorFor(profileId),
        locale: DEFAULT_LOCALE,
        currency: DEFAULT_CURRENCY,
        timezone: DEFAULT_TIMEZONE,
      },
      pinHash,
      linkId: this.ids.next(),
      now: this.clock.now(),
    });
    if (result.status === 'pending') throw new ProfileProposalPendingError();
    if (result.status === 'limit') throw new ProfileLimitReachedError();
    if (result.status !== 'created') throw new InvitationInvalidError();

    for (const accountId of new Set([result.targetAccountId, result.inviterAccountId])) {
      await log(this.securityLog, accountId, 'profile_invitation.redeemed', input.client, now);
    }
    this.events.publish({ type: 'circle.changed', profileIds: [profileId, result.inviterId] });

    if (input.email) {
      const email = normalizeEmail(input.email);
      const token = this.tokens.generate();
      const issued = await this.profiles.requestEmailVerification({
        tokenId: this.ids.next(),
        accountId: result.targetAccountId,
        profileId,
        email,
        tokenHash: this.tokens.hash(token),
        now,
        expiresAt: new Date(now.getTime() + PROFILE_EMAIL_VERIFY_TTL_MS),
      });
      if (issued === 'issued') {
        this.background.run('profile.email_verify_mail', async () => {
          await this.mailer.send(email, { kind: 'verify_profile_email', token });
        });
      }
    }
  }
}
