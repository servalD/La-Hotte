import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { InvalidCredentialsError, SecondFactorUnavailableError } from '../domain/account.errors';
import { AccountRepository, PasswordHasher } from '../domain/account.ports';
import { RateLimiter, SecurityLog, type SessionRef } from '../domain/ports';
import { RateLimitedError } from '../domain/session.errors';
import type { ClientInfo } from './client-info';
import { type IssuedSession, SessionLifecycle } from './session-lifecycle';

/**
 * Ré-authentification par mot de passe (AUTH-14, ADR 0013) : même session, nouveau jeton,
 * `reauth_at` posé, ancien jeton révoqué. Compteur d'échecs par compte (`01`, « Limitation »).
 * Le TOTP (tranche 3) et Google (tranche 4) s'y ajouteront ; d'ici là, un compte qui a l'un ou
 * l'autre sans mot de passe ne peut pas se ré-authentifier, et un compte à TOTP est refusé en
 * échec fermé.
 */
@Injectable()
export class Reauthenticate {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly hasher: PasswordHasher,
    private readonly limiter: RateLimiter,
    private readonly lifecycle: SessionLifecycle,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly session: SessionRef;
    readonly password: string;
    readonly client: ClientInfo;
  }): Promise<IssuedSession> {
    const accountId = input.session.accountId;
    const subjects = [{ scope: 'reauth' as const, parts: [accountId] }];
    const check = await this.limiter.check(subjects, this.clock.now());
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);

    const account = await this.accounts.findById(accountId);
    const valid = await this.hasher.verify(account?.passwordHash ?? null, input.password);
    if (!account || !valid) {
      await this.limiter.recordFailure(subjects, this.clock.now(), check.reservation);
      await this.log(accountId, 'reauth.failed', input.client);
      throw new InvalidCredentialsError();
    }
    if (account.totpEnabled) throw new SecondFactorUnavailableError();

    await this.limiter.recordSuccess(subjects, check.reservation);
    const issued = await this.lifecycle.rotate(input.session);
    await this.log(accountId, 'reauth.succeeded', input.client);
    return issued;
  }

  private async log(
    accountId: string,
    event: 'reauth.failed' | 'reauth.succeeded',
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
