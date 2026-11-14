/* eslint-disable @typescript-eslint/require-await -- doubles synchrones derrière des ports asynchrones */
import { MAX_PROFILES_PER_ACCOUNT } from '../domain/profile';
import type { SessionRef } from '../domain/ports';
import {
  type TransferPinChoice,
  type TransferSubject,
  TRANSFER_EXECUTION_DELAY_MS,
} from '../domain/transfer';
import {
  type CompletedTransfer,
  type IncomingTransfer,
  type TransferPreview,
  TransferRepository,
  type TransferState,
} from '../domain/transfer.ports';
import type { InMemoryAccountRepository, InMemorySessionStore } from './in-memory';
import type { InMemoryLinkRepository } from './in-memory-links';
import type { InMemoryWardRepository } from './in-memory-wards';

interface MemoryTransfer {
  id: string;
  kind: 'MOVE' | 'DETACH';
  profileId: string;
  fromAccountId: string;
  toAccountId: string | null;
  newEmail: string | null;
  tokenHash: string;
  tokenExpiresAt: Date;
  profileConsentRequired: boolean;
  regroup: boolean;
  fromAcceptedAt: Date;
  toAcceptedAt: Date | null;
  profileAcceptedAt: Date | null;
  pinChoice: TransferPinChoice;
  newPinHash: string | null;
  executesAt: Date | null;
  expiresAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

interface MemoryMailToken {
  transferId: string;
  profileId: string;
  purpose: 'TRANSFER_CONSENT' | 'TRANSFER_CANCEL';
  expiresAt: Date;
  usedAt: Date | null;
}

/**
 * Demandes de changement de compte en mémoire (tests de contrat) : mêmes règles que l'adaptateur
 * Prisma, sur les magasins partagés des comptes, profils, liens et sessions.
 */
export class InMemoryTransferRepository extends TransferRepository {
  readonly transfers = new Map<string, MemoryTransfer>();
  readonly mailTokens = new Map<string, MemoryMailToken>();

  constructor(
    private readonly accounts: InMemoryAccountRepository,
    private readonly links: InMemoryLinkRepository,
    private readonly wards: InMemoryWardRepository,
    private readonly sessions: InMemorySessionStore,
  ) {
    super();
  }

  private isOpen(t: MemoryTransfer, now: Date): boolean {
    return !t.completedAt && !t.cancelledAt && (t.executesAt !== null || t.expiresAt > now);
  }

  private state(t: MemoryTransfer): TransferState {
    return {
      id: t.id,
      kind: t.kind,
      profileId: t.profileId,
      fromAccountId: t.fromAccountId,
      toAccountId: t.toAccountId,
      newEmail: t.newEmail,
      profileConsentRequired: t.profileConsentRequired,
      regroup: t.regroup,
      fromAcceptedAt: t.fromAcceptedAt,
      toAcceptedAt: t.toAcceptedAt,
      profileAcceptedAt: t.profileAcceptedAt,
      pinChoice: t.pinChoice,
      executesAt: t.executesAt,
      expiresAt: t.expiresAt,
    };
  }

  private refresh(t: MemoryTransfer): void {
    if (t.toAcceptedAt && (!t.profileConsentRequired || t.profileAcceptedAt)) {
      const last = Math.max(
        t.fromAcceptedAt.getTime(),
        t.toAcceptedAt.getTime(),
        t.profileAcceptedAt?.getTime() ?? 0,
      );
      t.executesAt = new Date(last + TRANSFER_EXECUTION_DELAY_MS);
    } else {
      t.executesAt = null;
    }
  }

  private profilesOf(accountId: string) {
    return [...this.accounts.profiles.values()].filter((p) => p.accountId === accountId);
  }

  async subject(
    profileId: string,
  ): Promise<
    (TransferSubject & { readonly accountId: string; readonly email: string | null }) | null
  > {
    const p = this.accounts.profiles.get(profileId);
    if (!p) return null;
    return {
      accountId: p.accountId,
      isChild: p.isChild ?? false,
      childChangedAt: p.childChangedAt ?? null,
      hasPin: Boolean(p.pinHash),
      pinResetAt: p.pinResetAt ?? null,
      emailVerifiedAt: p.emailVerifiedAt ?? null,
      email: p.emailVerifiedAt ? (p.email ?? null) : null,
    };
  }

  async create(input: {
    readonly id: string;
    readonly kind: 'MOVE' | 'DETACH';
    readonly profileId: string;
    readonly fromAccountId: string;
    readonly newEmail: string | null;
    readonly tokenHash: string;
    readonly tokenExpiresAt: Date;
    readonly expiresAt: Date;
    readonly profileConsentRequired: boolean;
    readonly regroup: boolean;
    readonly pinChoice: TransferPinChoice;
    readonly newPinHash: string | null;
    readonly now: Date;
  }): Promise<'created' | 'pending' | 'missing'> {
    if (this.accounts.profiles.get(input.profileId)?.accountId !== input.fromAccountId) {
      return 'missing';
    }
    for (const t of this.transfers.values()) {
      if (t.profileId !== input.profileId || t.completedAt || t.cancelledAt) continue;
      if (!t.executesAt && t.expiresAt <= input.now) t.cancelledAt = input.now;
      else return 'pending';
    }
    const t: MemoryTransfer = {
      ...input,
      toAccountId: null,
      fromAcceptedAt: input.now,
      toAcceptedAt: input.kind === 'DETACH' ? input.now : null,
      profileAcceptedAt: null,
      executesAt: null,
      completedAt: null,
      cancelledAt: null,
    };
    this.refresh(t);
    this.transfers.set(t.id, t);
    return 'created';
  }

  async findOpenByProfile(profileId: string, now: Date): Promise<TransferState | null> {
    const t = [...this.transfers.values()].find(
      (x) => x.profileId === profileId && this.isOpen(x, now),
    );
    return t ? this.state(t) : null;
  }

  async findOpenByToken(
    tokenHash: string,
    kind: 'MOVE' | 'DETACH',
    now: Date,
  ): Promise<TransferState | null> {
    const t = [...this.transfers.values()].find(
      (x) =>
        x.tokenHash === tokenHash &&
        x.kind === kind &&
        x.tokenExpiresAt > now &&
        this.isOpen(x, now),
    );
    return t ? this.state(t) : null;
  }

  async canReceive(profileId: string, toAccountId: string): Promise<boolean> {
    const target = this.accounts.rows.get(toAccountId);
    const moving = this.accounts.profiles.get(profileId);
    if (!target || target.guardianAccountId || !moving || moving.accountId === toAccountId) {
      return false;
    }
    const linked = this.links
      .linksOf(profileId)
      .some(
        (l) =>
          l.status === 'ACCEPTED' &&
          this.accounts.profiles.get(l.otherId)?.accountId === toAccountId,
      );
    const blocked = this.links.blocks.some((b) => {
      const other =
        b.blockerId === profileId ? b.blockedId : b.blockedId === profileId ? b.blockerId : null;
      return other !== null && this.accounts.profiles.get(other)?.accountId === toAccountId;
    });
    return linked && !blocked;
  }

  async preview(transferId: string): Promise<TransferPreview | null> {
    const t = this.transfers.get(transferId);
    const p = t ? this.accounts.profiles.get(t.profileId) : null;
    return p
      ? {
          transferId,
          profileName: p.displayName,
          avatar: p.avatar ?? null,
          accentColor: p.accentColor,
          isChild: p.isChild ?? false,
        }
      : null;
  }

  async acceptDestination(input: {
    readonly transferId: string;
    readonly toAccountId: string;
    readonly now: Date;
  }): Promise<boolean> {
    const t = this.transfers.get(input.transferId);
    if (
      !t ||
      t.kind !== 'MOVE' ||
      t.toAcceptedAt ||
      t.fromAccountId === input.toAccountId ||
      !this.isOpen(t, input.now)
    ) {
      return false;
    }
    t.toAccountId = input.toAccountId;
    t.toAcceptedAt = input.now;
    this.refresh(t);
    return true;
  }

  async withdrawDestination(transferId: string, toAccountId: string): Promise<boolean> {
    const t = this.transfers.get(transferId);
    if (
      !t ||
      t.kind !== 'MOVE' ||
      t.toAccountId !== toAccountId ||
      t.completedAt ||
      t.cancelledAt
    ) {
      return false;
    }
    t.toAccountId = null;
    t.toAcceptedAt = null;
    t.executesAt = null;
    return true;
  }

  async consentProfile(input: {
    readonly transferId: string;
    readonly pinChoice: TransferPinChoice;
    readonly newPinHash: string | null;
    readonly now: Date;
  }): Promise<boolean> {
    const t = this.transfers.get(input.transferId);
    if (!t || !t.profileConsentRequired || t.profileAcceptedAt || !this.isOpen(t, input.now)) {
      return false;
    }
    t.profileAcceptedAt = input.now;
    t.pinChoice = input.pinChoice;
    t.newPinHash = input.newPinHash;
    this.refresh(t);
    return true;
  }

  async cancel(transferId: string, now: Date): Promise<boolean> {
    const t = this.transfers.get(transferId);
    if (!t || t.completedAt || t.cancelledAt) return false;
    t.cancelledAt = now;
    t.newPinHash = null;
    for (const token of this.mailTokens.values()) {
      if (token.transferId === transferId && !token.usedAt) token.usedAt = now;
    }
    return true;
  }

  async listIncoming(toAccountId: string, now: Date): Promise<IncomingTransfer[]> {
    return [...this.transfers.values()]
      .filter((t) => t.toAccountId === toAccountId && t.kind === 'MOVE' && this.isOpen(t, now))
      .flatMap((t) => {
        const p = this.accounts.profiles.get(t.profileId);
        return p
          ? [
              {
                id: t.id,
                profileName: p.displayName,
                accentColor: p.accentColor,
                executesAt: t.executesAt,
              },
            ]
          : [];
      });
  }

  async due(now: Date): Promise<{ readonly id: string; readonly kind: 'MOVE' | 'DETACH' }[]> {
    return [...this.transfers.values()]
      .filter((t) => !t.completedAt && !t.cancelledAt && t.executesAt && t.executesAt <= now)
      .map((t) => ({ id: t.id, kind: t.kind }));
  }

  async issueSetupToken(input: {
    readonly transferId: string;
    readonly tokenHash: string;
    readonly tokenExpiresAt: Date;
    readonly now: Date;
  }): Promise<boolean> {
    const t = this.transfers.get(input.transferId);
    if (!t || t.kind !== 'DETACH' || t.completedAt || t.cancelledAt) return false;
    if (!t.executesAt || t.executesAt > input.now) return false;
    t.tokenHash = input.tokenHash;
    t.tokenExpiresAt = input.tokenExpiresAt;
    if (t.expiresAt < input.tokenExpiresAt) t.expiresAt = input.tokenExpiresAt;
    return true;
  }

  async setupSent(transferId: string): Promise<boolean> {
    const t = this.transfers.get(transferId);
    return Boolean(t?.executesAt && t.tokenExpiresAt > t.executesAt);
  }

  async execute(input: {
    readonly transferId: string;
    readonly now: Date;
    readonly linkIds: () => string;
    readonly newAccount?: {
      readonly id: string;
      readonly email: string;
      readonly passwordHash: string;
    };
  }): Promise<CompletedTransfer | { readonly status: 'failed' | 'not_due' | 'email_taken' }> {
    const t = this.transfers.get(input.transferId);
    if (!t || t.completedAt || t.cancelledAt || !t.executesAt || t.executesAt > input.now) {
      return { status: 'not_due' };
    }
    const fail = (): { readonly status: 'failed' } => {
      if (t.kind === 'MOVE') {
        t.toAccountId = null;
        t.toAcceptedAt = null;
        t.executesAt = null;
      }
      return { status: 'failed' };
    };
    if (t.profileConsentRequired && !t.profileAcceptedAt) return fail();
    const profile = this.accounts.profiles.get(t.profileId);
    const from = this.accounts.rows.get(t.fromAccountId);
    if (!profile || profile.accountId !== t.fromAccountId || !from || from.guardianAccountId) {
      return fail();
    }

    let toAccountId = t.toAccountId;
    if (t.kind === 'DETACH') {
      if (!input.newAccount || t.newEmail !== input.newAccount.email) return fail();
      if (
        (await this.accounts.findByEmail(input.newAccount.email)) ||
        (await this.accounts.isEmailReserved(input.newAccount.email, null, input.now))
      ) {
        return { status: 'email_taken' };
      }
      toAccountId = input.newAccount.id;
    } else if (!toAccountId || !(await this.canReceive(t.profileId, toAccountId))) {
      return fail();
    }
    if (!toAccountId) return fail();
    if (this.profilesOf(toAccountId).length >= MAX_PROFILES_PER_ACCOUNT) return fail();
    const remaining = this.profilesOf(t.fromAccountId).filter((p) => p.id !== t.profileId);
    if (remaining.length === 0) {
      if (!t.regroup || t.kind !== 'MOVE' || (await this.wards.hasWards(t.fromAccountId))) {
        return fail();
      }
    }
    const pinHash =
      t.pinChoice === 'NEW' ? t.newPinHash : t.pinChoice === 'NONE' ? null : undefined;
    if (t.pinChoice === 'NEW' && !pinHash) return fail();
    const gapBefore = this.wards.gap(t.fromAccountId);

    // Contrôle du compte sans adulte sur l'état d'après, avant toute écriture.
    const before = { ...profile };
    profile.accountId = toAccountId;
    const gapAfter = remaining.length > 0 && !gapBefore && this.wards.gap(t.fromAccountId);
    profile.accountId = before.accountId;
    if (gapAfter) return fail();

    if (t.kind === 'DETACH' && input.newAccount) {
      this.accounts.seed({
        id: input.newAccount.id,
        email: input.newAccount.email,
        passwordHash: input.newAccount.passwordHash,
        emailVerifiedAt: input.now,
        createdAt: input.now,
      });
    }
    const deselected: SessionRef[] = [];
    for (const [id, row] of this.sessions.rows) {
      if (row.activeProfileId !== t.profileId) continue;
      this.sessions.rows.set(id, { ...row, activeProfileId: null });
      deselected.push({ id, accountId: t.fromAccountId, tokenHash: row.tokenHash });
    }
    const internal: string[] = [];
    for (const l of this.links.linksOf(t.profileId)) {
      if (this.accounts.profiles.get(l.otherId)?.accountId === toAccountId) {
        this.links.links.delete(l.id);
        internal.push(l.otherId);
      }
    }
    this.accounts.profiles.set(t.profileId, {
      ...profile,
      accountId: toAccountId,
      ...(pinHash !== undefined ? { pinHash } : {}),
      pinFailedCount: 0,
      pinLockedUntil: null,
      version: (profile.version ?? 1) + 1,
    });
    const created: string[] = [];
    for (const other of remaining) {
      const blocked = this.links.blocks.some(
        (b) =>
          (b.blockerId === t.profileId && b.blockedId === other.id) ||
          (b.blockerId === other.id && b.blockedId === t.profileId),
      );
      if (blocked) continue;
      this.links.addAcceptedLink({
        id: input.linkIds(),
        profileIds: [t.profileId, other.id],
        origin: 'TRANSFER',
        requestedBy: t.profileId,
        now: input.now,
      });
      created.push(other.id);
    }
    for (const invitation of this.links.invitations.values()) {
      if (
        invitation.createdBy === t.profileId &&
        invitation.kind === 'PROFILE' &&
        !invitation.revokedAt
      ) {
        invitation.revokedAt = input.now;
      }
    }
    for (const token of this.mailTokens.values()) {
      if (token.transferId === t.id && !token.usedAt) token.usedAt = input.now;
    }
    t.completedAt = input.now;
    t.toAccountId = toAccountId;
    t.newPinHash = null;
    return {
      status: 'completed',
      profileId: t.profileId,
      fromAccountId: t.fromAccountId,
      toAccountId,
      deselected,
      circleChanged: [
        ...new Set([
          t.profileId,
          ...remaining.map((r) => r.id),
          ...this.profilesOf(toAccountId)
            .map((p) => p.id)
            .filter((id) => id !== t.profileId),
          ...internal,
          ...created,
        ]),
      ],
      fromEmptied: remaining.length === 0,
      profileEmail: profile.emailVerifiedAt ? (profile.email ?? null) : null,
    };
  }

  async linkedNamesIn(profileId: string, accountId: string): Promise<string[]> {
    return this.links
      .linksOf(profileId)
      .filter((l) => l.status === 'ACCEPTED')
      .flatMap((l) => {
        const p = this.accounts.profiles.get(l.otherId);
        return p?.accountId === accountId ? [p.displayName] : [];
      })
      .sort();
  }

  async issueMailToken(input: {
    readonly id: string;
    readonly accountId: string;
    readonly profileId: string;
    readonly transferId: string;
    readonly purpose: 'TRANSFER_CONSENT' | 'TRANSFER_CANCEL';
    readonly tokenHash: string;
    readonly now: Date;
    readonly expiresAt: Date;
  }): Promise<void> {
    for (const token of this.mailTokens.values()) {
      if (
        token.transferId === input.transferId &&
        token.purpose === input.purpose &&
        !token.usedAt
      ) {
        token.usedAt = input.now;
      }
    }
    this.mailTokens.set(input.tokenHash, {
      transferId: input.transferId,
      profileId: input.profileId,
      purpose: input.purpose,
      expiresAt: input.expiresAt,
      usedAt: null,
    });
  }

  async findMailToken(
    tokenHash: string,
    purpose: 'TRANSFER_CONSENT' | 'TRANSFER_CANCEL',
    now: Date,
  ): Promise<{ readonly transferId: string; readonly profileId: string } | null> {
    const token = this.mailTokens.get(tokenHash);
    return token && token.purpose === purpose && !token.usedAt && token.expiresAt > now
      ? { transferId: token.transferId, profileId: token.profileId }
      : null;
  }

  async consumeMailToken(
    tokenHash: string,
    purpose: 'TRANSFER_CONSENT' | 'TRANSFER_CANCEL',
    now: Date,
  ): Promise<boolean> {
    const token = this.mailTokens.get(tokenHash);
    if (!token || token.purpose !== purpose || token.usedAt || token.expiresAt <= now) return false;
    token.usedAt = now;
    return true;
  }

  async suspendEmptyAccount(accountId: string): Promise<boolean> {
    if (this.profilesOf(accountId).length > 0) return false;
    const state = this.sessions.accounts.get(accountId);
    if (state) state.active = false;
    return true;
  }

  async deleteEmptyAccount(accountId: string): Promise<boolean> {
    if (this.profilesOf(accountId).length > 0) return false;
    return this.accounts.rows.delete(accountId);
  }
}
