import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { AccountRepository, BackgroundTasks } from '../domain/account.ports';
import { SecurityLog, type SessionRef } from '../domain/ports';
import { requiresSecondFactor } from '../domain/second-factor';
import { SecondFactorMandatoryError, TotpNotEnabledError } from '../domain/second-factor.errors';
import { SecondFactorRepository } from '../domain/second-factor.ports';
import { SessionRequiredError } from '../domain/session.errors';
import { AccountMailer } from './account-mailer';
import type { ClientInfo } from './client-info';
import { type IssuedSession, SessionLifecycle } from './session-lifecycle';

/**
 * Désactivation du TOTP (AUTH-05, AUTH-13, AUTH-14 : ré-authentification vérifiée par la garde).
 * Comme un changement de mot de passe : l'époque augmente (ADR 0014), toutes les sessions tombent,
 * puis une session neuve est ouverte pour l'appelant. Secret, codes de secours et appareils de
 * confiance disparaissent dans la même transaction. Refusée à un administrateur ou un modérateur.
 */
@Injectable()
export class DisableTotp {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly secondFactors: SecondFactorRepository,
    private readonly lifecycle: SessionLifecycle,
    private readonly securityLog: SecurityLog,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly session: SessionRef;
    readonly client: ClientInfo;
  }): Promise<IssuedSession> {
    const accountId = input.session.accountId;
    const state = await this.lifecycle.observe(accountId);
    const account = await this.accounts.findById(accountId);
    if (!state || !account) throw new SessionRequiredError();
    if (requiresSecondFactor(state.role)) throw new SecondFactorMandatoryError();
    if (!account.totpEnabled) throw new TotpNotEnabledError();

    const epoch = await this.lifecycle.changeEpoch(accountId, (authEpoch) =>
      this.secondFactors.disable(accountId, authEpoch, this.clock.now()),
    );
    await this.securityLog.record({
      accountId,
      event: 'totp.disabled',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: this.clock.now(),
    });
    this.background.run('totp.disabled_notice', async () => {
      const current = await this.accounts.findById(accountId);
      if (current) await this.mailer.send(current.email, { kind: 'totp_disabled' });
    });
    // L'ancienne session est déjà révoquée par `changeEpoch` ; pas de `previous`.
    return this.lifecycle.create({
      accountId,
      observedEpoch: epoch,
      userAgent: input.client.userAgent,
    });
  }
}
