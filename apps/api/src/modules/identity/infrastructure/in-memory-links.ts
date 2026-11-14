/* eslint-disable @typescript-eslint/require-await -- doubles synchrones derrière des ports asynchrones */
import {
  type BlockedRow,
  type CircleMember,
  type InvitationLookup,
  type LinkParty,
  type LinkPartyDetails,
  type LinkOrigin,
  type LinkRecord,
  type LinkSide,
  type LinkStatus,
  type OpenInvitation,
  orderPair,
  planLink,
} from '../domain/link';
import { LinkRepository, type RedeemOutcome } from '../domain/link.ports';
import type { InMemoryAccountRepository, MemoryProfile } from './in-memory';

interface MemoryInvitation {
  id: string;
  tokenHash: string;
  createdBy: string;
  maxUses: number;
  usedCount: number;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  updatedAt: Date;
}

interface MemoryLink {
  id: string;
  aId: string;
  bId: string;
  status: LinkStatus;
  origin: LinkOrigin;
  requestedBy: string;
  aGuardianRequired: boolean;
  bGuardianRequired: boolean;
  aGuardianApprovedBy: string | null;
  bGuardianApprovedBy: string | null;
  createdAt: Date;
}

interface MemoryBlock {
  id: string;
  blockerId: string;
  blockedId: string;
  createdAt: Date;
}

function party(profile: MemoryProfile): LinkPartyDetails {
  return {
    id: profile.id,
    accountId: profile.accountId,
    isChild: profile.isChild ?? false,
    displayName: profile.displayName,
    accentColor: profile.accentColor,
    avatar: profile.avatar ?? null,
  };
}

/**
 * Liens, blocages et invitations en mémoire (tests de contrat). Partage le magasin de profils des
 * comptes en mémoire : un profil posé à la main y est aussitôt lié, comme en base.
 */
export class InMemoryLinkRepository extends LinkRepository {
  readonly invitations = new Map<string, MemoryInvitation>();
  readonly links = new Map<string, MemoryLink>();
  readonly blocks: MemoryBlock[] = [];

  constructor(private readonly accounts: InMemoryAccountRepository) {
    super();
  }

  private profile(id: string): MemoryProfile | null {
    return this.accounts.profiles.get(id) ?? null;
  }

  /**
   * PRO-15 : tuteurs d'un enfant d'un compte sous tutelle (adultes du compte tuteur reliés par un
   * lien `GUARDIANSHIP`), comme `wardGuardiansOf` du dépôt Prisma.
   */
  private wardGuardianIds(child: MemoryProfile): string[] | null {
    if (!(child.isChild ?? false)) return null;
    const guardianAccountId = this.accounts.rows.get(child.accountId)?.guardianAccountId;
    if (!guardianAccountId) return null;
    return [...this.links.values()].flatMap((link) => {
      if (link.origin !== 'GUARDIANSHIP') return [];
      const otherId = link.aId === child.id ? link.bId : link.bId === child.id ? link.aId : null;
      const other = otherId ? this.profile(otherId) : null;
      return other && other.accountId === guardianAccountId && !(other.isChild ?? false)
        ? [other.id]
        : [];
    });
  }

  private party(profile: MemoryProfile): LinkPartyDetails {
    const guardians = this.wardGuardianIds(profile);
    return guardians ? { ...party(profile), wardGuardianIds: guardians } : party(profile);
  }

  private record(link: MemoryLink): LinkRecord {
    const a = this.profile(link.aId);
    const b = this.profile(link.bId);
    if (!a || !b) throw new Error('Profil de lien introuvable');
    return {
      id: link.id,
      status: link.status,
      origin: link.origin,
      requestedBy: link.requestedBy,
      a: this.party(a),
      b: this.party(b),
      aGuardianRequired: link.aGuardianRequired,
      bGuardianRequired: link.bGuardianRequired,
      aGuardianApprovedBy: link.aGuardianApprovedBy,
      bGuardianApprovedBy: link.bGuardianApprovedBy,
      createdAt: link.createdAt,
    };
  }

  private linkBetween(x: string, y: string): MemoryLink | undefined {
    const [a, b] = x < y ? [x, y] : [y, x];
    return [...this.links.values()].find((l) => l.aId === a && l.bId === b);
  }

  private blockedEitherWay(x: string, y: string): boolean {
    return this.blocks.some(
      (b) => (b.blockerId === x && b.blockedId === y) || (b.blockerId === y && b.blockedId === x),
    );
  }

  private isOpen(invitation: MemoryInvitation, now: Date): boolean {
    return (
      !invitation.revokedAt &&
      invitation.expiresAt.getTime() > now.getTime() &&
      invitation.usedCount < invitation.maxUses
    );
  }

  async findParty(profileId: string): Promise<LinkPartyDetails | null> {
    const profile = this.profile(profileId);
    return profile ? this.party(profile) : null;
  }

  async circleOf(profileId: string): Promise<CircleMember[]> {
    const me = this.profile(profileId);
    if (!me) return [];
    const members: CircleMember[] = [];
    const seen = new Set<string>([profileId]);
    const add = (profile: MemoryProfile, source: CircleMember['source']): void => {
      if (seen.has(profile.id) || this.blockedEitherWay(profileId, profile.id)) return;
      seen.add(profile.id);
      members.push({
        profileId: profile.id,
        displayName: profile.displayName,
        avatar: profile.avatar ?? null,
        accentColor: profile.accentColor,
        source,
      });
    };
    const siblings = [...this.accounts.profiles.values()]
      .filter((p) => p.accountId === me.accountId)
      .sort((x, y) => (x.createdAt?.getTime() ?? 0) - (y.createdAt?.getTime() ?? 0));
    for (const sibling of siblings) add(sibling, 'ACCOUNT');
    for (const link of this.links.values()) {
      if (link.status !== 'ACCEPTED') continue;
      const otherId = link.aId === profileId ? link.bId : link.bId === profileId ? link.aId : null;
      const other = otherId ? this.profile(otherId) : null;
      if (other) add(other, 'LINK');
    }
    return members;
  }

  async membersOf(profileId: string): Promise<string[]> {
    return (await this.circleOf(profileId)).map((member) => member.profileId);
  }

  async inCircle(profileId: string, otherProfileId: string): Promise<boolean> {
    return (await this.membersOf(profileId)).includes(otherProfileId);
  }

  async isBlockedEitherWay(profileId: string, otherProfileId: string): Promise<boolean> {
    return this.blockedEitherWay(profileId, otherProfileId);
  }

  async createInvitation(input: {
    readonly id: string;
    readonly tokenHash: string;
    readonly createdBy: string;
    readonly now: Date;
    readonly expiresAt: Date;
    readonly maxOpen: number;
  }): Promise<'created' | 'limit'> {
    const open = [...this.invitations.values()].filter(
      (i) => i.createdBy === input.createdBy && this.isOpen(i, input.now),
    ).length;
    if (open >= input.maxOpen) return 'limit';
    this.invitations.set(input.id, {
      id: input.id,
      tokenHash: input.tokenHash,
      createdBy: input.createdBy,
      maxUses: 1,
      usedCount: 0,
      createdAt: input.now,
      expiresAt: input.expiresAt,
      revokedAt: null,
      updatedAt: input.now,
    });
    return 'created';
  }

  async listOpenInvitations(profileId: string, now: Date): Promise<OpenInvitation[]> {
    return [...this.invitations.values()]
      .filter((i) => i.createdBy === profileId && this.isOpen(i, now))
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
      .map((i) => ({ id: i.id, createdAt: i.createdAt, expiresAt: i.expiresAt }));
  }

  async revokeInvitation(profileId: string, invitationId: string, now: Date): Promise<boolean> {
    const invitation = this.invitations.get(invitationId);
    if (
      !invitation ||
      invitation.createdBy !== profileId ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= now.getTime()
    ) {
      return false;
    }
    invitation.revokedAt = now;
    invitation.updatedAt = now;
    return true;
  }

  async findOpenInvitation(tokenHash: string, now: Date): Promise<InvitationLookup | null> {
    const invitation = [...this.invitations.values()].find((i) => i.tokenHash === tokenHash);
    return invitation ? this.lookup(invitation, now) : null;
  }

  private lookup(invitation: MemoryInvitation, now: Date): InvitationLookup | null {
    if (!this.isOpen(invitation, now)) return null;
    const inviter = this.profile(invitation.createdBy);
    return inviter
      ? { id: invitation.id, inviter: party(inviter), expiresAt: invitation.expiresAt }
      : null;
  }

  private createLink(
    id: string,
    inviter: MemoryProfile,
    other: MemoryProfile,
    now: Date,
  ): { linkId: string; status: LinkStatus } {
    const [a, b] = orderPair(party(inviter), party(other));
    const plan = planLink(a, b);
    this.links.set(id, {
      id,
      aId: a.id,
      bId: b.id,
      status: plan.status,
      origin: 'INVITATION',
      requestedBy: inviter.id,
      aGuardianRequired: plan.aGuardianRequired,
      bGuardianRequired: plan.bGuardianRequired,
      aGuardianApprovedBy: null,
      bGuardianApprovedBy: null,
      createdAt: now,
    });
    return { linkId: id, status: plan.status };
  }

  async redeemInvitation(input: {
    readonly tokenHash: string;
    readonly redeemerId: string;
    readonly linkId: string;
    readonly now: Date;
  }): Promise<RedeemOutcome> {
    const found = await this.findOpenInvitation(input.tokenHash, input.now);
    const redeemer = this.profile(input.redeemerId);
    if (!found || !redeemer) return { kind: 'invalid' };
    if (redeemer.id === found.inviter.id || redeemer.accountId === found.inviter.accountId) {
      return { kind: 'same_account' };
    }
    const inviter = this.profile(found.inviter.id);
    if (!inviter || this.blockedEitherWay(redeemer.id, inviter.id)) return { kind: 'invalid' };
    if (this.linkBetween(redeemer.id, inviter.id)) return { kind: 'already_linked' };
    const invitation = this.invitations.get(found.id);
    if (!invitation) return { kind: 'invalid' };
    invitation.usedCount += 1;
    invitation.updatedAt = input.now;
    return { kind: 'linked', ...this.createLink(input.linkId, inviter, redeemer, input.now) };
  }

  async consumePendingInvitation(input: {
    readonly accountId: string;
    readonly linkId: string;
    readonly now: Date;
  }): Promise<'none' | 'linked' | 'exhausted'> {
    const account = this.accounts.rows.get(input.accountId);
    const pending = account?.pendingInvitationId;
    if (!account || !pending) return 'none';
    const invitation = this.invitations.get(pending);
    const found = invitation ? this.lookup(invitation, input.now) : null;
    const first = [...this.accounts.profiles.values()]
      .filter((p) => p.accountId === input.accountId)
      .sort((x, y) => (x.createdAt?.getTime() ?? 0) - (y.createdAt?.getTime() ?? 0))[0];
    if (!invitation || !found || !first || found.inviter.accountId === input.accountId) {
      return 'exhausted';
    }
    const inviter = this.profile(found.inviter.id);
    if (!inviter || this.blockedEitherWay(first.id, inviter.id)) return 'exhausted';
    invitation.usedCount += 1;
    invitation.updatedAt = input.now;
    this.createLink(input.linkId, inviter, first, input.now);
    account.pendingInvitationId = null;
    account.emailVerifiedAt ??= input.now;
    return 'linked';
  }

  async listLinks(actor: LinkParty): Promise<LinkRecord[]> {
    return [...this.links.values()]
      .map((link) => this.record(link))
      .filter((link) => {
        if (link.a.id === actor.id || link.b.id === actor.id) return true;
        if (actor.isChild) return false;
        return [link.a, link.b].some(
          (p) =>
            p.isChild && (p.accountId === actor.accountId || p.wardGuardianIds?.includes(actor.id)),
        );
      })
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
  }

  async findLink(linkId: string): Promise<LinkRecord | null> {
    const link = this.links.get(linkId);
    return link ? this.record(link) : null;
  }

  async approveSide(input: {
    readonly linkId: string;
    readonly side: LinkSide;
    readonly guardianId: string;
    readonly now: Date;
  }): Promise<LinkRecord | null> {
    const link = this.links.get(input.linkId);
    if (!link || link.status !== 'AWAITING_GUARDIAN') return null;
    if (input.side === 'A') {
      if (!link.aGuardianRequired || link.aGuardianApprovedBy) return null;
      link.aGuardianApprovedBy = input.guardianId;
    } else {
      if (!link.bGuardianRequired || link.bGuardianApprovedBy) return null;
      link.bGuardianApprovedBy = input.guardianId;
    }
    const done =
      (!link.aGuardianRequired || link.aGuardianApprovedBy) &&
      (!link.bGuardianRequired || link.bGuardianApprovedBy);
    if (done) link.status = 'ACCEPTED';
    return this.record(link);
  }

  async deleteLink(linkId: string): Promise<LinkRecord | null> {
    const link = this.links.get(linkId);
    if (!link) return null;
    const record = this.record(link);
    this.links.delete(linkId);
    return record;
  }

  async block(input: {
    readonly id: string;
    readonly blockerId: string;
    readonly blockedId: string;
    readonly now: Date;
  }): Promise<'blocked' | 'not_linked'> {
    const link = this.linkBetween(input.blockerId, input.blockedId);
    // PRO-15 : un lien de tutelle ne se bloque pas.
    if (!link || link.origin === 'GUARDIANSHIP') return 'not_linked';
    this.links.delete(link.id);
    if (
      !this.blocks.some((b) => b.blockerId === input.blockerId && b.blockedId === input.blockedId)
    ) {
      this.blocks.push({
        id: input.id,
        blockerId: input.blockerId,
        blockedId: input.blockedId,
        createdAt: input.now,
      });
    }
    return 'blocked';
  }

  async unblock(blockerId: string, blockedId: string): Promise<boolean> {
    const index = this.blocks.findIndex(
      (b) => b.blockerId === blockerId && b.blockedId === blockedId,
    );
    if (index < 0) return false;
    this.blocks.splice(index, 1);
    return true;
  }

  async listBlocks(blockerId: string): Promise<BlockedRow[]> {
    return this.blocks
      .filter((b) => b.blockerId === blockerId)
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
      .flatMap((b) => {
        const blocked = this.profile(b.blockedId);
        return blocked
          ? [
              {
                profileId: blocked.id,
                displayName: blocked.displayName,
                accentColor: blocked.accentColor,
                isChild: blocked.isChild ?? false,
              },
            ]
          : [];
      });
  }

  async purgeInvitations(before: Date): Promise<number> {
    let purged = 0;
    for (const [id, i] of this.invitations) {
      const ended =
        i.expiresAt < before ||
        (i.revokedAt !== null && i.revokedAt < before) ||
        (i.usedCount >= i.maxUses && i.updatedAt < before);
      if (!ended) continue;
      this.invitations.delete(id);
      purged += 1;
    }
    return purged;
  }
}
