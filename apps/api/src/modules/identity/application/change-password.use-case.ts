import { Injectable } from '@nestjs/common';
import { GuardianNotices } from './guardian-notices';
import { Clock } from '../../../shared/domain';
import { AccountRepository, BackgroundTasks } from '../domain/account.ports';
import { AccountMailer } from './account-mailer';
import { SecurityLog, type SessionRef } from '../domain/ports';
import type { ClientInfo } from './client-info';
import { PasswordPolicy } from './password-policy';
import { type IssuedSession, SessionLifecycle } from './session-lifecycle';

/**
 * Changement de mot de passe (AUTH-05, AUTH-14 : ré-authentification vérifiée par la garde).
 * L'époque du compte augmente (ADR 0014) : toutes les sessions tombent, celle-ci comprise, puis
 * une session neuve est ouverte pour l'appelant, à la nouvelle époque. Les autres appareils sont
 * donc déconnectés à leur requête suivante.
 */
@Injectable()
export class ChangePassword {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly passwords: PasswordPolicy,
    private readonly lifecycle: SessionLifecycle,
    private readonly securityLog: SecurityLog,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly guardianNotices: GuardianNotices,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly session: SessionRef;
    readonly newPassword: string;
    readonly client: ClientInfo;
  }): Promise<IssuedSession> {
    const passwordHash = await this.passwords.hashNew(input.newPassword);
    const accountId = input.session.accountId;
    const epoch = await this.lifecycle.changeEpoch(accountId, (authEpoch) =>
      this.accounts.setPassword({
        accountId,
        passwordHash,
        authEpoch,
        reset: false,
        now: this.clock.now(),
      }),
    );
    await this.securityLog.record({
      accountId,
      event: 'password.changed',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: this.clock.now(),
    });
    // AUTH-16 : avis à l'adresse du compte, après la réponse.
    this.background.run('password.changed_notice', async () => {
      const account = await this.accounts.findById(accountId);
      if (account) await this.mailer.send(account.email, { kind: 'password_changed' });
    });
    this.guardianNotices.notify(accountId, 'password');
    // L'ancienne session est déjà révoquée par `changeEpoch` ; pas de `previous`.
    return this.lifecycle.create({
      accountId,
      observedEpoch: epoch,
      userAgent: input.client.userAgent,
    });
  }
}
