import { Injectable } from '@nestjs/common';
import {
  type AuditAction,
  AuditJournal,
  type AuditValue,
  type AuditWrite,
  Clock,
  IdGenerator,
} from '../../../shared/domain';
import { tokenExpiry } from '../domain/account';
import { ProfileRepository } from '../domain/profile.ports';
import {
  AccountStateConflictError,
  AdminSelfActionError,
  AdminTargetNotFoundError,
  LastAdminError,
  RoleRequirementsNotMetError,
} from '../domain/account-admin.errors';
import {
  AccountAdministration,
  type AdminTarget,
  type RoleChangeOutcome,
} from '../domain/account-administration';
import { AccountTokenInvalidError } from '../domain/account.errors';
import { AccountRepository } from '../domain/account.ports';
import { SecretTokens, SecurityLog } from '../domain/ports';
import { requiresSecondFactor } from '../domain/second-factor';
import type { AccountRole } from '../domain/session';
import { AccountMailer, type MailKind } from './account-mailer';
import type { ClientInfo } from './client-info';
import { SessionLifecycle } from './session-lifecycle';

/** Action d'un administrateur (RBAC-06) : qui, d'où, pourquoi. */
export interface AdminActionInput {
  readonly actorAccountId: string;
  readonly targetAccountId: string;
  /** RBAC-06 : 10 à 500 caractères, vérifié à la frontière. */
  readonly reason: string;
  readonly ip: string;
}

/** Outils communs : entrées d'audit, compte visé, suite hors base (AUD-05). */
@Injectable()
export class AdminActionKit {
  constructor(
    readonly administration: AccountAdministration,
    readonly lifecycle: SessionLifecycle,
    private readonly mailer: AccountMailer,
    private readonly journal: AuditJournal,
    private readonly ids: IdGenerator,
    readonly clock: Clock,
  ) {}

  write(
    input: Pick<AdminActionInput, 'actorAccountId' | 'targetAccountId' | 'ip'> & {
      readonly reason: string | null;
    },
    action: AuditAction,
    values: { readonly before?: AuditValue; readonly after?: AuditValue } = {},
  ): AuditWrite {
    return {
      id: this.ids.next(),
      at: this.clock.now(),
      entry: {
        actorAccountId: input.actorAccountId,
        action,
        targetKind: 'ACCOUNT',
        targetId: input.targetAccountId,
        reason: input.reason,
        ip: input.ip,
        ...values,
      },
    };
  }

  /** RBAC-06 : jamais sur soi-même (le retrait de son propre rôle passe par `ChangeAccountRole`). */
  async target(input: AdminActionInput): Promise<AdminTarget> {
    if (input.actorAccountId === input.targetAccountId) throw new AdminSelfActionError();
    const target = await this.administration.target(input.targetAccountId);
    if (!target) throw new AdminTargetNotFoundError();
    return target;
  }

  /**
   * AUD-05 : l'e-mail part après la transaction. S'il ne part pas, l'action reste faite et une
   * seconde entrée le dit.
   */
  async notify(
    input: AdminActionInput,
    to: string,
    mail: MailKind,
    action: AuditAction,
  ): Promise<void> {
    let sent = false;
    try {
      sent = await this.mailer.send(to, mail);
    } catch {
      sent = false;
    }
    if (!sent) {
      await this.journal.append(
        this.write({ ...input, reason: null }, 'followup.failed', { after: action }),
      );
    }
  }
}

/** ADM-06 : suspension ; l'époque coupe toutes les sessions, même en cache (ADR 0014). */
@Injectable()
export class SuspendAccount {
  constructor(private readonly kit: AdminActionKit) {}

  async execute(input: AdminActionInput): Promise<void> {
    const target = await this.kit.target(input);
    if (target.status !== 'ACTIVE') throw new AccountStateConflictError();
    // ADM-06 : un administrateur se retire d'abord son rôle (RBAC-07), jamais suspendu tel quel.
    if (target.role === 'ADMIN') throw new AccountStateConflictError();
    let done = false as boolean;
    await this.kit.lifecycle.changeEpoch(target.accountId, async (authEpoch) => {
      done = await this.kit.administration.suspend({
        accountId: target.accountId,
        authEpoch,
        audit: this.kit.write(input, 'account.suspend'),
      });
    });
    if (!done) throw new AccountStateConflictError();
    await this.kit.notify(input, target.email, { kind: 'account_suspended' }, 'account.suspend');
  }
}

/** ADM-06 : réactivation d'un compte suspendu par l'administration, et de lui seul. */
@Injectable()
export class ReactivateAccount {
  constructor(private readonly kit: AdminActionKit) {}

  async execute(input: AdminActionInput): Promise<void> {
    const target = await this.kit.target(input);
    if (target.status !== 'SUSPENDED' || !target.suspendedByAdmin) {
      throw new AccountStateConflictError();
    }
    const done = await this.kit.administration.reactivate({
      accountId: target.accountId,
      audit: this.kit.write(input, 'account.reactivate'),
    });
    if (!done) throw new AccountStateConflictError();
    await this.kit.notify(
      input,
      target.email,
      { kind: 'account_reactivated' },
      'account.reactivate',
    );
  }
}

/** ADM-08 : toutes les sessions révoquées, rien d'autre. */
@Injectable()
export class ForceLogout {
  constructor(private readonly kit: AdminActionKit) {}

  async execute(input: AdminActionInput): Promise<void> {
    const target = await this.kit.target(input);
    await this.kit.lifecycle.changeEpoch(target.accountId, (authEpoch) =>
      this.kit.administration.writeEpoch({
        accountId: target.accountId,
        authEpoch,
        audit: this.kit.write(input, 'account.force_logout'),
      }),
    );
  }
}

/**
 * RBAC-03, RBAC-07 : attribution ou retrait d'un rôle. Un administrateur ne change que le rôle
 * d'un autre compte, sauf pour retirer le sien ; le dernier administrateur garde le sien.
 */
@Injectable()
export class ChangeAccountRole {
  constructor(private readonly kit: AdminActionKit) {}

  async execute(input: AdminActionInput & { readonly role: AccountRole }): Promise<void> {
    const self = input.actorAccountId === input.targetAccountId;
    if (self && input.role !== 'USER') throw new AdminSelfActionError();
    const target = await this.kit.administration.target(input.targetAccountId);
    if (!target) throw new AdminTargetNotFoundError();
    if (target.role === input.role) return;
    if (
      input.role !== 'USER' &&
      (!target.totpEnabled ||
        !target.emailVerified ||
        target.underGuardianship ||
        target.status !== 'ACTIVE')
    ) {
      throw new RoleRequirementsNotMetError();
    }
    let outcome = 'unchanged' as RoleChangeOutcome;
    await this.kit.lifecycle.changeEpoch(target.accountId, async (authEpoch) => {
      outcome = await this.kit.administration.setRole({
        accountId: target.accountId,
        role: input.role,
        authEpoch,
        now: this.kit.clock.now(),
        audits: (before) => [
          this.kit.write(input, input.role === 'USER' ? 'role.revoke' : 'role.grant', {
            before,
            after: input.role,
          }),
        ],
      });
    });
    if (outcome === 'last_admin') throw new LastAdminError();
    if (outcome === 'changed') {
      await this.kit.notify(input, target.email, { kind: 'role_changed' }, 'role.grant');
    }
  }
}

/**
 * ADM-07 : l'administrateur déclenche l'envoi d'un lien au titulaire ; il ne voit ni ne choisit
 * aucun secret. Un administrateur ou un modérateur perd d'abord son rôle (AUTH-13).
 */
@Injectable()
export class RequestTotpReset {
  constructor(
    private readonly kit: AdminActionKit,
    private readonly accounts: AccountRepository,
    private readonly tokens: SecretTokens,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: AdminActionInput): Promise<void> {
    const target = await this.kit.target(input);
    if (!target.totpEnabled || !target.emailVerified || target.status !== 'ACTIVE') {
      throw new AccountStateConflictError();
    }
    const request = this.kit.write(input, 'account.totp_reset_requested');
    if (requiresSecondFactor(target.role)) {
      let outcome = 'unchanged' as RoleChangeOutcome;
      await this.kit.lifecycle.changeEpoch(target.accountId, async (authEpoch) => {
        outcome = await this.kit.administration.setRole({
          accountId: target.accountId,
          role: 'USER',
          authEpoch,
          now: this.kit.clock.now(),
          audits: (before) => [
            this.kit.write(input, 'role.revoke', { before, after: 'USER' }),
            request,
          ],
        });
      });
      if (outcome === 'last_admin') throw new LastAdminError();
    } else {
      await this.kit.administration.recordTotpResetRequest(request);
    }
    const now = this.kit.clock.now();
    const token = this.tokens.generate();
    await this.accounts.issueToken({
      id: this.ids.next(),
      accountId: target.accountId,
      purpose: 'TOTP_RESET',
      tokenHash: this.tokens.hash(token),
      newEmail: null,
      createdAt: now,
      expiresAt: tokenExpiry('TOTP_RESET', now),
    });
    await this.kit.notify(
      input,
      target.email,
      { kind: 'totp_reset', token },
      'account.totp_reset_requested',
    );
  }
}

/**
 * MOD-10 : publication au catalogue global suspendue pour le compte de l'auteur d'un contenu
 * retiré. Appelé par la modération, dont la décision porte déjà l'entrée d'audit.
 */
@Injectable()
export class SuspendPublication {
  constructor(
    private readonly administration: AccountAdministration,
    private readonly clock: Clock,
  ) {}

  async execute(authorProfileId: string): Promise<void> {
    await this.administration.setPublicationSuspended({
      profileId: authorProfileId,
      accountId: null,
      at: this.clock.now(),
      audit: null,
    });
  }
}

/** MOD-10 : un modérateur ou un administrateur lève la suspension de publication d'un compte. */
@Injectable()
export class RestorePublication {
  constructor(private readonly kit: AdminActionKit) {}

  async execute(input: AdminActionInput): Promise<void> {
    const target = await this.kit.target(input);
    const done = await this.kit.administration.setPublicationSuspended({
      profileId: null,
      accountId: target.accountId,
      at: null,
      audit: this.kit.write(input, 'publication.restore'),
    });
    if (!done) throw new AdminTargetNotFoundError();
  }
}

/**
 * ADM-07 : le titulaire ouvre le lien. TOTP, codes de secours et appareils de confiance retirés,
 * toutes les sessions coupées par l'époque. Aucune session n'est ouverte.
 */
@Injectable()
export class ConfirmTotpReset {
  constructor(
    private readonly kit: AdminActionKit,
    private readonly accounts: AccountRepository,
    private readonly tokens: SecretTokens,
    private readonly securityLog: SecurityLog,
  ) {}

  async execute(input: { readonly token: string; readonly client: ClientInfo }): Promise<void> {
    if (!this.tokens.isWellFormed(input.token)) throw new AccountTokenInvalidError();
    const consumed = await this.accounts.consumeToken(
      this.tokens.hash(input.token),
      ['TOTP_RESET'],
      this.kit.clock.now(),
    );
    if (!consumed) throw new AccountTokenInvalidError();
    const accountId = consumed.accountId;
    let done = false as boolean;
    await this.kit.lifecycle.changeEpoch(accountId, async (authEpoch) => {
      done = await this.kit.administration.completeTotpReset({
        accountId,
        authEpoch,
        now: this.kit.clock.now(),
        audit: this.kit.write(
          {
            actorAccountId: accountId,
            targetAccountId: accountId,
            ip: input.client.ip,
            reason: null,
          },
          'account.totp_reset_completed',
        ),
      });
    });
    if (!done) return;
    await this.securityLog.record({
      accountId,
      event: 'totp.disabled',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: this.kit.clock.now(),
    });
    const account = await this.accounts.findById(accountId);
    // AUD-05 : un avertissement qui ne part pas laisse une entrée « échec de la suite ».
    if (account) {
      await this.kit.notify(
        { actorAccountId: accountId, targetAccountId: accountId, ip: input.client.ip, reason: '' },
        account.email,
        { kind: 'totp_disabled' },
        'account.totp_reset_completed',
      );
    }
  }
}

/** ADM-05 : profils d'un compte de la plateforme, pour soustraire à un modérateur ce qui le concerne. */
@Injectable()
export class AccountProfileIds {
  constructor(private readonly profiles: ProfileRepository) {}

  execute(accountId: string): Promise<string[]> {
    return this.profiles.listIds(accountId);
  }
}
