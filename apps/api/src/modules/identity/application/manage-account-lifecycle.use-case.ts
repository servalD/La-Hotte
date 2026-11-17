import { Injectable } from '@nestjs/common';
import { Clock, DomainError } from '../../../shared/domain';
import {
  AccountLifecycle,
  DELETION_GRACE_MS,
  INACTIVITY_WARNINGS,
  inactivityThreshold,
} from '../domain/account-lifecycle';
import type { AccountCredentials } from '../domain/account';
import { AccountRepository } from '../domain/account.ports';
import { type AccountAuthState, SecurityLog, type SecurityEvent } from '../domain/ports';
import { AccountMailer } from './account-mailer';
import type { ClientInfo } from './client-info';
import { SessionLifecycle } from './session-lifecycle';

/** RGPD-12 : un compte tuteur d'un autre ne se supprime pas tant que la tutelle dure. */
export class AccountHasWardsError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'HAS_WARDS';
  constructor() {
    super('Ce compte est tuteur d’un autre compte : levez d’abord la tutelle.');
  }
}

/** RGPD-12, RBAC-03 : le dernier administrateur ne se supprime pas. */
export class LastAdminDeletionError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'LAST_ADMIN';
  constructor() {
    super('Le dernier administrateur ne peut pas supprimer son compte.');
  }
}

/**
 * RGPD-12 : demande d'effacement depuis l'espace Compte (ré-authentification à la frontière).
 * Toutes les sessions tombent par l'époque ; une connexion réussie dans les 30 jours annule.
 */
@Injectable()
export class RequestAccountDeletion {
  constructor(
    private readonly lifecycle: AccountLifecycle,
    private readonly sessions: SessionLifecycle,
    private readonly accounts: AccountRepository,
    private readonly mailer: AccountMailer,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly client: ClientInfo;
  }): Promise<{ readonly effectiveAt: Date }> {
    const blocker = await this.lifecycle.deletionBlocker(input.accountId);
    if (blocker === 'has_wards') throw new AccountHasWardsError();
    if (blocker === 'last_admin') throw new LastAdminDeletionError();
    const at = this.clock.now();
    let outcome = 'missing' as Awaited<ReturnType<AccountLifecycle['requestDeletion']>>;
    await this.sessions.changeEpoch(input.accountId, async (authEpoch) => {
      outcome = await this.lifecycle.requestDeletion({ accountId: input.accountId, authEpoch, at });
    });
    if (outcome === 'has_wards') throw new AccountHasWardsError();
    if (outcome === 'last_admin') throw new LastAdminDeletionError();
    const effectiveAt = new Date(at.getTime() + DELETION_GRACE_MS);
    if (outcome === 'requested') {
      await this.securityLog.record({
        accountId: input.accountId,
        event: 'account.deletion_requested',
        ip: input.client.ip,
        userAgent: input.client.userAgent,
        at,
      });
      const account = await this.accounts.findById(input.accountId);
      if (account)
        await this.mailer.send(account.email, { kind: 'deletion_scheduled', effectiveAt });
    }
    return { effectiveAt };
  }
}

/**
 * RGPD-12 : une connexion réussie (premier facteur vérifié) pendant le délai de grâce annule la
 * demande ; le titulaire en est averti. Rend le compte et son état relus.
 */
@Injectable()
export class ResumeAccountOnSignIn {
  constructor(
    private readonly lifecycle: AccountLifecycle,
    private readonly sessions: SessionLifecycle,
    private readonly accounts: AccountRepository,
    private readonly mailer: AccountMailer,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(
    account: AccountCredentials,
    state: AccountAuthState,
    client: ClientInfo,
  ): Promise<{ account: AccountCredentials; state: AccountAuthState }> {
    if (!account.pendingDeletion) return { account, state };
    if (!(await this.lifecycle.cancelDeletion(account.accountId))) return { account, state };
    await this.securityLog.record({
      accountId: account.accountId,
      event: 'account.deletion_cancelled' satisfies SecurityEvent,
      ip: client.ip,
      userAgent: client.userAgent,
      at: this.clock.now(),
    });
    await this.mailer.send(account.email, { kind: 'deletion_cancelled' });
    const [fresh, freshState] = await Promise.all([
      this.accounts.findById(account.accountId),
      this.sessions.observe(account.accountId),
    ]);
    return { account: fresh ?? account, state: freshState ?? state };
  }
}

/** RGPD-12 : exécution des effacements échus, par lots ; chaque compte est revérifié. */
@Injectable()
export class EraseDueAccounts {
  constructor(
    private readonly lifecycle: AccountLifecycle,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    const before = new Date(now.getTime() - DELETION_GRACE_MS);
    let erased = 0;
    for (const accountId of await this.lifecycle.dueForErasure(before, 50)) {
      if (await this.lifecycle.erase(accountId, before)) {
        erased += 1;
        // SEC-30 : la ligne survit au compte (pas de clé étrangère), sans contenu.
        await this.securityLog.record({
          accountId,
          event: 'account.erased',
          ip: '0.0.0.0',
          userAgent: 'task:account.erase',
          at: now,
        });
      }
    }
    return erased;
  }
}

/**
 * RGPD-13 : avertissements à 30 puis 7 jours, puis demande d'effacement sans délai de plus (le
 * délai de l'avertissement en tient lieu). Un compte administrateur ou modérateur n'est jamais visé.
 */
@Injectable()
export class HandleInactiveAccounts {
  constructor(
    private readonly lifecycle: AccountLifecycle,
    private readonly mailer: AccountMailer,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<{ readonly warned: number; readonly scheduled: number }> {
    const now = this.clock.now();
    let warned = 0;
    for (const { notices, daysLeft } of INACTIVITY_WARNINGS) {
      const before = inactivityThreshold(now, daysLeft);
      for (const account of await this.lifecycle.inactive({ before, notices, limit: 100 })) {
        if (await this.lifecycle.markWarned(account.accountId, notices, before)) {
          warned += 1;
          await this.mailer.send(account.email, { kind: 'inactivity_warning', daysLeft });
        }
      }
    }
    const due = inactivityThreshold(now, 0);
    let scheduled = 0;
    for (const account of await this.lifecycle.inactive({ before: due, notices: 2, limit: 100 })) {
      const done = await this.lifecycle.requestDeletionForInactivity({
        accountId: account.accountId,
        before: due,
        requestedAt: new Date(now.getTime() - DELETION_GRACE_MS - 1),
      });
      if (done) scheduled += 1;
    }
    return { warned, scheduled };
  }
}
