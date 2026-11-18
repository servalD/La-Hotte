import {
  ACTIONS_SHOWN_TO_HOLDER,
  AccountDirectory,
  type AccountMetadata,
  type AdminActionOnAccount,
  type InMemoryAuditTrail,
  REASON_SHOWN_TO_HOLDER,
} from '../../src/modules/admin/testing';
import type { InMemoryAccountAdministration } from '../../src/modules/identity/testing';
import type {
  InMemoryAccountRepository,
  InMemorySessionStore,
} from '../../src/modules/identity/testing';

/** Double de l'annuaire d'administration, lu dans les doubles d'`identity` et le journal. */
export class InMemoryAccountDirectory extends AccountDirectory {
  constructor(
    private readonly sessions: InMemorySessionStore,
    private readonly accounts: InMemoryAccountRepository,
    private readonly administration: InMemoryAccountAdministration,
    private readonly audit: InMemoryAuditTrail,
  ) {
    super();
  }

  async findByEmail(email: string): Promise<AccountMetadata | null> {
    const row = [...this.accounts.rows.values()].find((r) => r.email === email);
    if (!row) return null;
    const target = await this.administration.target(row.id);
    const state = this.sessions.accounts.get(row.id);
    if (!target || !state) return null;
    return {
      accountId: row.id,
      createdAt: row.createdAt,
      lastSignInAt: null,
      profileCount: [...this.accounts.profiles.values()].filter((p) => p.accountId === row.id)
        .length,
      listCount: 0,
      role: target.role,
      status: target.status,
      totpEnabled: target.totpEnabled,
      emailVerified: target.emailVerified,
      publicationSuspended: false,
      suspensions: this.audit.rows
        .filter(
          (r) =>
            r.targetId === row.id &&
            (r.action === 'account.suspend' || r.action === 'account.reactivate'),
        )
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .map((r) => ({ action: r.action, at: r.at })),
    };
  }

  actionsOn(accountId: string): Promise<AdminActionOnAccount[]> {
    const shown = new Set<string>(ACTIONS_SHOWN_TO_HOLDER);
    return Promise.resolve(
      this.audit.rows
        .filter(
          (r) => r.targetKind === 'ACCOUNT' && r.targetId === accountId && shown.has(r.action),
        )
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, 50)
        .map((r) => ({
          action: r.action,
          at: r.at,
          reason: REASON_SHOWN_TO_HOLDER.has(r.action) ? r.reason : null,
        })),
    );
  }
}
