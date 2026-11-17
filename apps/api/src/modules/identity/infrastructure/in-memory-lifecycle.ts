import {
  AccountLifecycle,
  type DeletionRequestOutcome,
  type InactiveAccount,
} from '../domain/account-lifecycle';
import type { InMemoryAccountRepository, InMemorySessionStore } from './in-memory';

/** Double du cycle de vie d'un compte (RGPD-12, RGPD-13), sur les doubles d'`identity`. */
export class InMemoryAccountLifecycle extends AccountLifecycle {
  /** RGPD-13 : dernière connexion connue ; à défaut, la création du compte. */
  readonly lastSignInAt = new Map<string, Date>();
  readonly notices = new Map<string, number>();
  readonly erased = new Set<string>();

  constructor(
    private readonly sessions: InMemorySessionStore,
    private readonly accounts: InMemoryAccountRepository,
  ) {
    super();
  }

  private lastSeen(accountId: string): Date {
    return (
      this.lastSignInAt.get(accountId) ?? this.accounts.rows.get(accountId)?.createdAt ?? new Date()
    );
  }

  requestDeletion(input: {
    accountId: string;
    authEpoch: number;
    at: Date;
  }): Promise<DeletionRequestOutcome> {
    const state = this.sessions.accounts.get(input.accountId);
    const row = this.accounts.rows.get(input.accountId);
    if (!state || !row) return Promise.resolve('missing');
    if (row.pendingDeletionAt) return Promise.resolve('already');
    if (!state.active) return Promise.resolve('missing');
    if ([...this.accounts.rows.values()].some((r) => r.guardianAccountId === input.accountId)) {
      return Promise.resolve('has_wards');
    }
    if (
      state.role === 'ADMIN' &&
      ![...this.sessions.accounts.entries()].some(
        ([id, a]) => id !== input.accountId && a.role === 'ADMIN' && a.active,
      )
    ) {
      return Promise.resolve('last_admin');
    }
    row.pendingDeletionAt = input.at;
    state.active = false;
    this.sessions.commitEpoch(input.accountId, input.authEpoch);
    return Promise.resolve('requested');
  }

  deletionBlocker(accountId: string): Promise<'has_wards' | 'last_admin' | null> {
    if ([...this.accounts.rows.values()].some((r) => r.guardianAccountId === accountId)) {
      return Promise.resolve('has_wards');
    }
    const state = this.sessions.accounts.get(accountId);
    if (
      state?.role === 'ADMIN' &&
      ![...this.sessions.accounts.entries()].some(
        ([id, a]) => id !== accountId && a.role === 'ADMIN' && a.active,
      )
    ) {
      return Promise.resolve('last_admin');
    }
    return Promise.resolve(null);
  }

  cancelDeletion(accountId: string): Promise<boolean> {
    const row = this.accounts.rows.get(accountId);
    const state = this.sessions.accounts.get(accountId);
    if (!row?.pendingDeletionAt || !state) return Promise.resolve(false);
    row.pendingDeletionAt = null;
    state.active = true;
    return Promise.resolve(true);
  }

  dueForErasure(before: Date, limit: number): Promise<string[]> {
    return Promise.resolve(
      [...this.accounts.rows.values()]
        .filter((r) => r.pendingDeletionAt && r.pendingDeletionAt < before)
        .slice(0, limit)
        .map((r) => r.id),
    );
  }

  erase(accountId: string, before: Date): Promise<boolean> {
    const row = this.accounts.rows.get(accountId);
    if (!row?.pendingDeletionAt || row.pendingDeletionAt >= before) return Promise.resolve(false);
    for (const [id, profile] of this.accounts.profiles) {
      if (profile.accountId === accountId) this.accounts.profiles.delete(id);
    }
    for (const [id, session] of this.sessions.rows) {
      if (session.accountId === accountId) this.sessions.rows.delete(id);
    }
    this.accounts.rows.delete(accountId);
    this.sessions.accounts.delete(accountId);
    this.erased.add(accountId);
    return Promise.resolve(true);
  }

  inactive(input: { before: Date; notices: 0 | 1 | 2; limit: number }): Promise<InactiveAccount[]> {
    return Promise.resolve(
      [...this.accounts.rows.values()]
        .filter((r) => {
          const state = this.sessions.accounts.get(r.id);
          return (
            state?.active === true &&
            state.role === 'USER' &&
            r.emailVerifiedAt !== null &&
            (this.notices.get(r.id) ?? 0) === input.notices &&
            this.lastSeen(r.id) < input.before
          );
        })
        .slice(0, input.limit)
        .map((r) => ({ accountId: r.id, email: r.email })),
    );
  }

  markWarned(accountId: string, from: 0 | 1, before: Date): Promise<boolean> {
    if ((this.notices.get(accountId) ?? 0) !== from || this.lastSeen(accountId) >= before) {
      return Promise.resolve(false);
    }
    this.notices.set(accountId, from + 1);
    return Promise.resolve(true);
  }

  requestDeletionForInactivity(input: {
    accountId: string;
    before: Date;
    requestedAt: Date;
  }): Promise<boolean> {
    const row = this.accounts.rows.get(input.accountId);
    const state = this.sessions.accounts.get(input.accountId);
    if (
      !row ||
      !state?.active ||
      (this.notices.get(input.accountId) ?? 0) !== 2 ||
      this.lastSeen(input.accountId) >= input.before
    ) {
      return Promise.resolve(false);
    }
    row.pendingDeletionAt = input.requestedAt;
    state.active = false;
    return Promise.resolve(true);
  }
}
