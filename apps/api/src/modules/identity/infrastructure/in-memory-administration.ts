import type { AuditWrite } from '../../../shared/domain';
import {
  AccountAdministration,
  type AdminTarget,
  type RoleChangeOutcome,
} from '../domain/account-administration';
import type { AccountRole } from '../domain/session';
import type { InMemoryAccountRepository, InMemorySessionStore } from './in-memory';

/**
 * Double de l'administration des comptes. État d'authentification dans le magasin de sessions,
 * fiche du compte dans le dépôt des comptes ; `audit` reçoit les entrées de la « transaction ».
 */
export class InMemoryAccountAdministration extends AccountAdministration {
  /** Comptes suspendus par l'administration (ADM-06). */
  readonly suspendedByAdmin = new Set<string>();

  constructor(
    private readonly sessions: InMemorySessionStore,
    private readonly accounts: InMemoryAccountRepository,
    private readonly audit: (write: AuditWrite) => void,
  ) {
    super();
  }

  target(accountId: string): Promise<AdminTarget | null> {
    const state = this.sessions.accounts.get(accountId);
    if (!state) return Promise.resolve(null);
    const row = this.accounts.rows.get(accountId);
    return Promise.resolve({
      accountId,
      email: row?.email ?? `${accountId}@lahotte.test`,
      role: state.role,
      status: state.active ? 'ACTIVE' : 'SUSPENDED',
      emailVerified: row ? row.emailVerifiedAt !== null : true,
      totpEnabled: row?.totpEnabled ?? false,
      underGuardianship: Boolean(row?.guardianAccountId),
      suspendedByAdmin: this.suspendedByAdmin.has(accountId),
    });
  }

  suspend(input: { accountId: string; authEpoch: number; audit: AuditWrite }): Promise<boolean> {
    const state = this.sessions.accounts.get(input.accountId);
    if (!state?.active) return Promise.resolve(false);
    this.audit(input.audit);
    state.active = false;
    this.sessions.commitEpoch(input.accountId, input.authEpoch);
    this.suspendedByAdmin.add(input.accountId);
    return Promise.resolve(true);
  }

  reactivate(input: { accountId: string; audit: AuditWrite }): Promise<boolean> {
    const state = this.sessions.accounts.get(input.accountId);
    if (!state || state.active || !this.suspendedByAdmin.has(input.accountId)) {
      return Promise.resolve(false);
    }
    this.audit(input.audit);
    state.active = true;
    this.suspendedByAdmin.delete(input.accountId);
    return Promise.resolve(true);
  }

  writeEpoch(input: { accountId: string; authEpoch: number; audit: AuditWrite }): Promise<void> {
    this.audit(input.audit);
    this.sessions.commitEpoch(input.accountId, input.authEpoch);
    return Promise.resolve();
  }

  setRole(input: {
    accountId: string;
    role: AccountRole;
    authEpoch: number;
    audits: (before: AccountRole) => readonly AuditWrite[];
  }): Promise<RoleChangeOutcome> {
    const state = this.sessions.accounts.get(input.accountId);
    if (!state || state.role === input.role) return Promise.resolve('unchanged');
    if (state.role === 'ADMIN') {
      const admins = [...this.sessions.accounts.values()].filter(
        (a) => a.role === 'ADMIN' && a.active,
      );
      if (admins.length <= 1) return Promise.resolve('last_admin');
    }
    for (const write of input.audits(state.role)) this.audit(write);
    state.role = input.role;
    this.sessions.commitEpoch(input.accountId, input.authEpoch);
    return Promise.resolve('changed');
  }

  completeTotpReset(input: {
    accountId: string;
    authEpoch: number;
    now: Date;
    audit: AuditWrite;
  }): Promise<boolean> {
    const row = this.accounts.rows.get(input.accountId);
    if (!row?.totpEnabled) return Promise.resolve(false);
    this.audit(input.audit);
    row.totpEnabled = false;
    this.sessions.commitEpoch(input.accountId, input.authEpoch);
    return Promise.resolve(true);
  }

  recordTotpResetRequest(audit: AuditWrite): Promise<void> {
    this.audit(audit);
    return Promise.resolve();
  }
}
