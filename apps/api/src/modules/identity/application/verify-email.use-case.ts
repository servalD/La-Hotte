import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { AccountTokenInvalidError } from '../domain/account.errors';
import { AccountRepository } from '../domain/account.ports';
import { SecretTokens, SecurityLog } from '../domain/ports';
import type { ClientInfo } from './client-info';

/**
 * Lien reçu par e-mail (`POST /auth/email/verify`, jeton dans le corps, ADR 0013) : vérification
 * de l'adresse d'un compte neuf (AUTH-01, AUTH-15), ou confirmation d'un changement d'adresse
 * (AUTH-16). **N'ouvre jamais de session** : le jeton prouve la boîte, pas l'inscription. Qui a
 * reçu le lien d'une inscription faite par un autre ne connaît pas le mot de passe ; il passe par
 * la réinitialisation, qui évince l'auteur (AUTH-06, AUTH-15). Un seul message de refus, quelle
 * qu'en soit la raison (adresse prise ou réservée comprise).
 */
@Injectable()
export class VerifyEmail {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly tokens: SecretTokens,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: { readonly token: string; readonly client: ClientInfo }): Promise<void> {
    if (!this.tokens.isWellFormed(input.token)) throw new AccountTokenInvalidError();
    const now = this.clock.now();
    const consumed = await this.accounts.consumeToken(
      this.tokens.hash(input.token),
      ['EMAIL_VERIFY', 'EMAIL_CHANGE'],
      now,
    );
    if (!consumed) throw new AccountTokenInvalidError();

    if (consumed.purpose === 'EMAIL_CHANGE') {
      if (!consumed.newEmail) throw new AccountTokenInvalidError();
      if (!(await this.accounts.changeEmail(consumed.accountId, consumed.newEmail, now))) {
        throw new AccountTokenInvalidError();
      }
      await this.log(consumed.accountId, 'email.changed', input.client);
      return;
    }
    await this.accounts.markEmailVerified(consumed.accountId, now);
    await this.log(consumed.accountId, 'email.verified', input.client);
  }

  private async log(
    accountId: string,
    event: 'email.changed' | 'email.verified',
    client: ClientInfo,
  ): Promise<void> {
    await this.securityLog.record({
      accountId,
      event,
      ip: client.ip,
      userAgent: client.userAgent,
      at: this.clock.now(),
    });
  }
}
