import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { InvalidCredentialsError } from '../domain/account.errors';
import { AccountRepository, PasswordHasher } from '../domain/account.ports';
import { RateLimiter, SecurityLog, type SessionRef } from '../domain/ports';
import type { RateLimitSubject } from '../domain/rate-limit';
import { parseSecondFactorCode } from '../domain/second-factor';
import {
  InvalidSecondFactorError,
  SecondFactorRequiredError,
} from '../domain/second-factor.errors';
import { RateLimitedError } from '../domain/session.errors';
import type { ClientInfo } from './client-info';
import { SecondFactorVerifier } from './second-factor-verifier';
import { type IssuedSession, SessionLifecycle } from './session-lifecycle';

/**
 * Ré-authentification (AUTH-14, ADR 0013) : mot de passe, plus un code TOTP ou de secours si le
 * TOTP est actif. Même session, nouveau jeton, `reauth_at` posé, ancien jeton révoqué.
 *
 * Compteur par compte (`01`, « Limitation ») ; avec le TOTP, un code faux compte **aussi** sur le
 * compteur du second facteur (un mot de passe faux, non) : la ré-authentification n'offre pas un
 * second chemin pour essayer des codes. Google s'y ajoutera (tranche 4) ; d'ici là, un
 * compte sans mot de passe ne peut pas se ré-authentifier.
 */
@Injectable()
export class Reauthenticate {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly hasher: PasswordHasher,
    private readonly verifier: SecondFactorVerifier,
    private readonly limiter: RateLimiter,
    private readonly lifecycle: SessionLifecycle,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly session: SessionRef;
    readonly password: string;
    readonly code: string | null;
    readonly client: ClientInfo;
  }): Promise<IssuedSession> {
    const accountId = input.session.accountId;
    const account = await this.accounts.findById(accountId);
    // Le titulaire de la session sait si son TOTP est actif : le dire avant tout essai ne révèle
    // rien et ne consomme pas d'essai.
    const totp = account?.totpEnabled ?? false;
    if (totp && !input.code) throw new SecondFactorRequiredError();

    const reauth: RateLimitSubject[] = [{ scope: 'reauth', parts: [accountId] }];
    const check = await this.limiter.check(reauth, this.clock.now());
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);

    const valid = await this.hasher.verify(account?.passwordHash ?? null, input.password);
    if (!account || !valid) {
      await this.limiter.recordFailure(reauth, this.clock.now(), check.reservation);
      await this.log(accountId, 'reauth.failed', input.client);
      throw new InvalidCredentialsError();
    }
    if (totp) {
      // Le compteur du second facteur n'est réservé qu'une fois le mot de passe validé : un mot de
      // passe faux n'y compte pas (sinon qui tient la session sans le mot de passe retarderait les
      // connexions du titulaire). Pendant son délai, la réservation `reauth` expire seule.
      const factor: RateLimitSubject[] = [{ scope: 'second_factor', parts: [accountId] }];
      const factorCheck = await this.limiter.check(factor, this.clock.now());
      if (!factorCheck.allowed || !factorCheck.reservation) {
        throw new RateLimitedError(factorCheck.retryAfterMs);
      }
      const code = parseSecondFactorCode(input.code ?? '');
      const used = code ? await this.verifier.verify(accountId, code) : null;
      if (!used) {
        const [failures = 0] = await this.limiter.recordFailure(
          factor,
          this.clock.now(),
          factorCheck.reservation,
        );
        await this.verifier.noteFailures(accountId, failures);
        await this.limiter.recordFailure(reauth, this.clock.now(), check.reservation);
        await this.log(accountId, 'totp.failed', input.client);
        throw new InvalidSecondFactorError();
      }
      await this.limiter.recordSuccess(factor, factorCheck.reservation);
      if (used === 'recovery') await this.log(accountId, 'recovery.code_used', input.client);
    }

    await this.limiter.recordSuccess(reauth, check.reservation);
    const issued = await this.lifecycle.rotate(input.session);
    await this.log(accountId, 'reauth.succeeded', input.client);
    return issued;
  }

  private async log(
    accountId: string,
    event: 'reauth.failed' | 'reauth.succeeded' | 'totp.failed' | 'recovery.code_used',
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
