import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { normalizeEmail } from '../domain/account';
import {
  AccountSuspendedError,
  InvalidCredentialsError,
  SecondFactorUnavailableError,
} from '../domain/account.errors';
import { AccountRepository, PasswordHasher } from '../domain/account.ports';
import { RateLimiter, SecurityLog, type SessionRef } from '../domain/ports';
import type { RateLimitSubject } from '../domain/rate-limit';
import { RateLimitedError } from '../domain/session.errors';
import type { ClientInfo } from './client-info';
import { type IssuedSession, SessionLifecycle } from './session-lifecycle';

const NO_ACCOUNT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Connexion par mot de passe (AUTH-01, AUTH-07, ADR 0013, ADR 0014).
 *
 * - Limitation d'abord : pendant le délai, `429` sans évaluer les identifiants. Clés par e-mail
 *   normalisé, pour toute adresse inscrite ou non : un `429` ne révèle rien.
 * - Époque du compte lue **avant** la vérification du mot de passe (ADR 0014).
 * - Compte absent ou sans mot de passe : vérification argon2 factice de même coût, même refus.
 * - Navigateur qui avait déjà une session : elle est révoquée côté serveur (rotation).
 */
@Injectable()
export class SignInWithPassword {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly hasher: PasswordHasher,
    private readonly limiter: RateLimiter,
    private readonly lifecycle: SessionLifecycle,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly email: string;
    readonly password: string;
    readonly client: ClientInfo;
    readonly previous: SessionRef | null;
  }): Promise<IssuedSession> {
    const email = normalizeEmail(input.email);
    const subjects: RateLimitSubject[] = [
      { scope: 'login_pair', parts: [email, input.client.ip] },
      { scope: 'login_account', parts: [email] },
      { scope: 'login_ip', parts: [input.client.ip] },
    ];
    const check = await this.limiter.check(subjects, this.clock.now());
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);
    const reservation = check.reservation;

    // ADR 0014 : l'époque est lue **avant** le hash. Le premier accès ne sert qu'à trouver
    // l'identifiant ; le hash vérifié est relu après l'époque, pour qu'un changement de mot de
    // passe terminé entre les deux ne laisse pas vérifier l'ancien hash à la nouvelle époque.
    // Sans compte, mêmes appels avec un identifiant nul.
    const accountId = (await this.accounts.findByEmail(email))?.accountId ?? NO_ACCOUNT_ID;
    const observedEpoch = await this.lifecycle.observeEpoch(accountId);
    const account = await this.accounts.findById(accountId);
    const valid = await this.hasher.verify(account?.passwordHash ?? null, input.password);

    // AUTH-15 : un compte non vérifié reçoit le même refus qu'un mot de passe faux (sinon une
    // inscription suivie d'une connexion dirait si l'adresse avait déjà un compte).
    if (!account || !valid || observedEpoch === null || !account.emailVerified) {
      await this.limiter.recordFailure(subjects, this.clock.now(), reservation);
      await this.log(account?.accountId ?? null, 'login.failed', input.client);
      throw new InvalidCredentialsError();
    }
    if (!account.active) {
      await this.limiter.recordFailure(subjects, this.clock.now(), reservation);
      await this.log(account.accountId, 'login.failed', input.client);
      throw new AccountSuspendedError();
    }
    // Second facteur (AUTH-12) : tranche 3. Aucun compte ne peut encore l'activer ; s'il en
    // existait un, refus en échec fermé plutôt qu'une session sans second facteur. La
    // réservation expire seule (10 s), sans compter d'échec.
    if (account.totpEnabled) throw new SecondFactorUnavailableError();

    await this.limiter.recordSuccess(subjects, reservation);
    const issued = await this.lifecycle.create({
      accountId: account.accountId,
      observedEpoch,
      userAgent: input.client.userAgent,
      previous: input.previous,
    });
    await this.log(account.accountId, 'login.succeeded', input.client);
    return issued;
  }

  private async log(
    accountId: string | null,
    event: 'login.failed' | 'login.succeeded',
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
