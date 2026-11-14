import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import { normalizeEmail, tokenExpiry } from '../domain/account';
import { AccountRepository, BackgroundTasks } from '../domain/account.ports';
import { RateLimiter, SecretTokens } from '../domain/ports';
import { RateLimitedError } from '../domain/session.errors';
import type { ClientInfo } from './client-info';
import { AccountMailer } from './account-mailer';

/**
 * Demande de réinitialisation (AUTH-06). Même réponse, même délai, que l'adresse ait un compte ou
 * non : la recherche, le jeton et l'e-mail viennent après la réponse. Seule la limitation par IP
 * peut répondre `429` ; le quota par destinataire ne fait que retenir l'e-mail.
 */
@Injectable()
export class RequestPasswordReset {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly limiter: RateLimiter,
    private readonly tokens: SecretTokens,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: { readonly email: string; readonly client: ClientInfo }): Promise<void> {
    const subjects = [{ scope: 'reset_ip' as const, parts: [input.client.ip] }];
    const now = this.clock.now();
    const check = await this.limiter.check(subjects, now);
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);
    await this.limiter.recordFailure(subjects, now, check.reservation);

    const email = normalizeEmail(input.email);
    this.background.run('password.reset_request', () => this.issue(email));
  }

  private async issue(email: string): Promise<void> {
    const account = await this.accounts.findByEmail(email);
    if (!account?.active) return;
    const now = this.clock.now();
    const token = this.tokens.generate();
    await this.accounts.issueToken({
      id: this.ids.next(),
      accountId: account.accountId,
      purpose: 'PASSWORD_RESET',
      tokenHash: this.tokens.hash(token),
      newEmail: null,
      createdAt: now,
      expiresAt: tokenExpiry('PASSWORD_RESET', now),
    });
    await this.mailer.send(account.email, { kind: 'reset_password', token });
  }
}
