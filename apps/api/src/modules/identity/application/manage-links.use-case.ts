import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import { normalizeEmail } from '../domain/account';
import { AccountRepository, BackgroundTasks } from '../domain/account.ports';
import {
  approvableSide,
  type BlockedProfile,
  toBlockedProfile,
  canBreakLink,
  type CircleMember,
  INVITATION_TTL_MS,
  linkViewFor,
  type LinkStatus,
  type LinkView,
  MAX_OPEN_INVITATIONS_PER_PROFILE,
  type OpenInvitation,
} from '../domain/link';
import {
  AlreadyLinkedError,
  BlockSelfError,
  ChildEmailForbiddenError,
  InvitationInvalidError,
  InvitationLimitReachedError,
  LinkNotFoundError,
  LinkSameAccountError,
} from '../domain/link.errors';
import { LinkRepository } from '../domain/link.ports';
import {
  IdentityEvents,
  RateLimiter,
  SecretTokens,
  type SecurityEvent,
  SecurityLog,
} from '../domain/ports';
import { EmailNotVerifiedError } from '../domain/second-factor.errors';
import { RateLimitedError, SessionRequiredError } from '../domain/session.errors';
import { GuardianRequiredError } from '../domain/ward.errors';
import { AccountMailer } from './account-mailer';
import type { ActiveProfile } from './authorize-profile.use-case';
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

/** Le profil actif tel que le voient les règles de lien (SEC-03 : il vient de la session). */
async function partyOf(links: LinkRepository, active: ActiveProfile) {
  const party = await links.findParty(active.id);
  if (!party || party.accountId !== active.accountId) throw new SessionRequiredError();
  return party;
}

export interface CreatedInvitation {
  readonly id: string;
  /** Rendu **une seule fois** : seul son hash est conservé (LNK-01). */
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * LNK-01 : création d'une invitation (lien, QR code, ou e-mail). Profil actif déverrouillé, compte
 * vérifié, plafonds par profil. Un profil enfant n'invite pas par e-mail (PRO-05). L'adresse invitée
 * n'est pas conservée (RGPD-02) : elle ne sert qu'à l'envoi.
 */
@Injectable()
export class CreateInvitation {
  constructor(
    private readonly links: LinkRepository,
    private readonly accounts: AccountRepository,
    private readonly tokens: SecretTokens,
    private readonly limiter: RateLimiter,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly active: ActiveProfile;
    readonly email?: string;
    readonly client: ClientInfo;
  }): Promise<CreatedInvitation> {
    const inviter = await partyOf(this.links, input.active);
    const account = await this.accounts.findById(input.active.accountId);
    if (!account) throw new SessionRequiredError();
    if (!account.emailVerified) throw new EmailNotVerifiedError();
    if (input.email && inviter.isChild) throw new ChildEmailForbiddenError();

    const now = this.clock.now();
    const subjects = [{ scope: 'invitation_profile' as const, parts: [inviter.id] }];
    const check = await this.limiter.check(subjects, now);
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);

    const token = this.tokens.generateInvitation();
    const id = this.ids.next();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    const created = await this.links.createInvitation({
      id,
      tokenHash: this.tokens.hash(token),
      createdBy: inviter.id,
      now,
      expiresAt,
      maxOpen: MAX_OPEN_INVITATIONS_PER_PROFILE,
    });
    if (created === 'limit') throw new InvitationLimitReachedError();
    // Compté après succès : un plafond atteint ne consomme pas le budget de 24 heures.
    await this.limiter.recordFailure(subjects, now, check.reservation);
    await log(this.securityLog, input.active.accountId, 'invitation.created', input.client, now);
    if (input.email) {
      const to = normalizeEmail(input.email);
      this.background.run('invitation.mail', async () => {
        await this.mailer.send(to, {
          kind: 'link_invitation',
          token,
          inviterName: inviter.displayName,
        });
      });
    }
    return { id, token, expiresAt };
  }
}

/** LNK-01 : invitations ouvertes du profil actif (jamais leur jeton). */
@Injectable()
export class ListInvitations {
  constructor(
    private readonly links: LinkRepository,
    private readonly clock: Clock,
  ) {}

  async execute(active: ActiveProfile): Promise<OpenInvitation[]> {
    return this.links.listOpenInvitations(active.id, this.clock.now());
  }
}

/** LNK-01 : révocation, limitée aux invitations du profil actif (`404` sinon, SEC-04). */
@Injectable()
export class RevokeInvitation {
  constructor(
    private readonly links: LinkRepository,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly active: ActiveProfile;
    readonly invitationId: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const now = this.clock.now();
    if (!(await this.links.revokeInvitation(input.active.id, input.invitationId, now))) {
      throw new LinkNotFoundError();
    }
    await log(this.securityLog, input.active.accountId, 'invitation.revoked', input.client, now);
  }
}

export interface InvitationPreview {
  /** Absent si l'invitant est un enfant (LNK-07, PRO-05). */
  readonly inviterName: string | null;
  readonly inviterAccentColor: string;
  readonly expiresAt: Date;
}

/**
 * LNK-07 : ce que voit celui qui ouvre un lien avant d'accepter. Refus commun pour un jeton
 * invalide ou un blocage ; sans session et profil actif, rien ne se lit.
 */
@Injectable()
export class InspectInvitation {
  constructor(
    private readonly links: LinkRepository,
    private readonly tokens: SecretTokens,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly active: ActiveProfile;
    readonly token: string;
  }): Promise<InvitationPreview> {
    const found = await this.links.findOpenInvitation(
      this.tokens.hash(input.token),
      this.clock.now(),
    );
    if (!found) throw new InvitationInvalidError();
    if (found.inviter.accountId === input.active.accountId) throw new LinkSameAccountError();
    if (await this.links.isBlockedEitherWay(input.active.id, found.inviter.id)) {
      throw new InvitationInvalidError();
    }
    return {
      inviterName: found.inviter.isChild ? null : found.inviter.displayName,
      inviterAccentColor: found.inviter.accentColor,
      expiresAt: found.expiresAt,
    };
  }
}

/**
 * LNK-06, LNK-07 : ouverture d'une invitation par le profil actif. Le lien est accepté d'office,
 * ou attend la validation d'un tuteur si un enfant est partie. Un seul refus pour tout jeton
 * inutilisable ; rien n'est consommé si le lien existe déjà.
 */
@Injectable()
export class RedeemInvitation {
  constructor(
    private readonly links: LinkRepository,
    private readonly accounts: AccountRepository,
    private readonly tokens: SecretTokens,
    private readonly events: IdentityEvents,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly active: ActiveProfile;
    readonly token: string;
    readonly client: ClientInfo;
  }): Promise<{ readonly linkId: string; readonly status: LinkStatus }> {
    const account = await this.accounts.findById(input.active.accountId);
    if (!account) throw new SessionRequiredError();
    if (!account.emailVerified) throw new EmailNotVerifiedError();
    const now = this.clock.now();
    const outcome = await this.links.redeemInvitation({
      tokenHash: this.tokens.hash(input.token),
      redeemerId: input.active.id,
      linkId: this.ids.next(),
      now,
    });
    switch (outcome.kind) {
      case 'invalid':
        throw new InvitationInvalidError();
      case 'already_linked':
        throw new AlreadyLinkedError();
      case 'same_account':
        throw new LinkSameAccountError();
      case 'linked':
        break;
    }
    await log(this.securityLog, input.active.accountId, 'link.created', input.client, now);
    if (outcome.status === 'ACCEPTED') {
      const link = await this.links.findLink(outcome.linkId);
      if (link) this.events.publish({ type: 'circle.changed', profileIds: [link.a.id, link.b.id] });
    }
    return { linkId: outcome.linkId, status: outcome.status };
  }
}

/** LNK-09 : le cercle du profil actif, lu en base (jamais depuis un cache). */
@Injectable()
export class ListCircle {
  constructor(private readonly links: LinkRepository) {}

  async execute(active: ActiveProfile): Promise<CircleMember[]> {
    return this.links.circleOf(active.id);
  }
}

/** LNK-06 : liens du profil actif, et ceux qu'il garde (partie enfant de son compte). */
@Injectable()
export class ListLinks {
  constructor(private readonly links: LinkRepository) {}

  async execute(active: ActiveProfile): Promise<LinkView[]> {
    const viewer = await partyOf(this.links, active);
    const records = await this.links.listLinks(viewer);
    return records.flatMap((record) => {
      const view = linkViewFor(record, viewer);
      return view ? [view] : [];
    });
  }
}

/**
 * LNK-06 : validation d'un côté enfant par un profil non enfant de son compte. `404` pour tout
 * autre cas (lien inconnu, déjà validé, profil qui n'est pas tuteur) : SEC-04.
 */
@Injectable()
export class ApproveLink {
  constructor(
    private readonly links: LinkRepository,
    private readonly events: IdentityEvents,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly active: ActiveProfile;
    readonly linkId: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const guardian = await partyOf(this.links, input.active);
    const link = await this.links.findLink(input.linkId);
    const side = link ? approvableSide(link, guardian) : null;
    if (!link || side === null) throw new LinkNotFoundError();
    const now = this.clock.now();
    const updated = await this.links.approveSide({
      linkId: link.id,
      side,
      guardianId: guardian.id,
      now,
    });
    if (!updated) throw new LinkNotFoundError();
    await log(this.securityLog, input.active.accountId, 'link.approved', input.client, now);
    if (updated.status === 'ACCEPTED') {
      this.events.publish({ type: 'circle.changed', profileIds: [updated.a.id, updated.b.id] });
    }
  }
}

/** LNK-02 : rupture par l'une des parties ou le tuteur d'une partie enfant ; `404` sinon. */
@Injectable()
export class BreakLink {
  constructor(
    private readonly links: LinkRepository,
    private readonly events: IdentityEvents,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly active: ActiveProfile;
    readonly linkId: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const actor = await partyOf(this.links, input.active);
    const link = await this.links.findLink(input.linkId);
    if (!link || !canBreakLink(link, actor)) throw new LinkNotFoundError();
    const deleted = await this.links.deleteLink(link.id);
    if (!deleted) throw new LinkNotFoundError();
    if (deleted === 'guardian_required') throw new GuardianRequiredError();
    await log(
      this.securityLog,
      input.active.accountId,
      'link.deleted',
      input.client,
      this.clock.now(),
    );
    this.events.publish({ type: 'circle.changed', profileIds: [deleted.a.id, deleted.b.id] });
  }
}

/**
 * LNK-05 : bloque une contrepartie d'un lien du profil actif et supprime ce lien. `404` si le
 * profil visé n'est pas lié au profil actif : on ne sonde pas l'existence d'un profil.
 */
@Injectable()
export class BlockProfile {
  constructor(
    private readonly links: LinkRepository,
    private readonly events: IdentityEvents,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly active: ActiveProfile;
    readonly profileId: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    if (input.profileId === input.active.id) throw new BlockSelfError();
    const target = await this.links.findParty(input.profileId);
    if (!target) throw new LinkNotFoundError();
    if (target.accountId === input.active.accountId) throw new LinkSameAccountError();
    const now = this.clock.now();
    const result = await this.links.block({
      id: this.ids.next(),
      blockerId: input.active.id,
      blockedId: target.id,
      now,
    });
    if (result === 'not_linked') throw new LinkNotFoundError();
    await log(this.securityLog, input.active.accountId, 'block.created', input.client, now);
    this.events.publish({ type: 'circle.changed', profileIds: [input.active.id, target.id] });
  }
}

/** LNK-05 : lève un blocage ; le lien n'est pas rétabli. */
@Injectable()
export class UnblockProfile {
  constructor(
    private readonly links: LinkRepository,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly active: ActiveProfile;
    readonly profileId: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    if (!(await this.links.unblock(input.active.id, input.profileId))) {
      throw new LinkNotFoundError();
    }
    await log(
      this.securityLog,
      input.active.accountId,
      'block.removed',
      input.client,
      this.clock.now(),
    );
  }
}

/** LNK-05 : profils que le profil actif a bloqués (le nom d'un enfant en est absent, PRO-05). */
@Injectable()
export class ListBlocks {
  constructor(private readonly links: LinkRepository) {}

  async execute(active: ActiveProfile): Promise<BlockedProfile[]> {
    return (await this.links.listBlocks(active.id)).map(toBlockedProfile);
  }
}
