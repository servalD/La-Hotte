import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { AccountTokenInvalidError } from '../domain/account.errors';
import { AccountRepository } from '../domain/account.ports';
import { SecretTokens, SecurityLog } from '../domain/ports';
import type { ClientInfo } from './client-info';
import { PasswordPolicy } from './password-policy';
import { SessionLifecycle } from './session-lifecycle';

/**
 * Réinitialisation confirmée (AUTH-06). Le nouveau mot de passe est contrôlé **avant** que le
 * jeton soit consommé (un refus pour fuite ne brûle pas le lien). Puis, par l'époque du compte
 * (ADR 0014) : toutes les sessions et pré-authentifications refusées, appareils de confiance
 * révoqués, e-mail marqué vérifié (le lien le prouve). Aucune session n'est ouverte : on se
 * reconnecte avec le nouveau mot de passe.
 */
@Injectable()
export class ConfirmPasswordReset {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly passwords: PasswordPolicy,
    private readonly tokens: SecretTokens,
    private readonly lifecycle: SessionLifecycle,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly token: string;
    readonly newPassword: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    if (!this.tokens.isWellFormed(input.token)) throw new AccountTokenInvalidError();
    const passwordHash = await this.passwords.hashNew(input.newPassword);

    const consumed = await this.accounts.consumeToken(
      this.tokens.hash(input.token),
      ['PASSWORD_RESET'],
      this.clock.now(),
    );
    if (!consumed) throw new AccountTokenInvalidError();

    await this.lifecycle.changeEpoch(consumed.accountId, (authEpoch) =>
      this.accounts.setPassword({
        accountId: consumed.accountId,
        passwordHash,
        authEpoch,
        reset: true,
        now: this.clock.now(),
      }),
    );
    await this.securityLog.record({
      accountId: consumed.accountId,
      event: 'password.reset',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: this.clock.now(),
    });
  }
}
