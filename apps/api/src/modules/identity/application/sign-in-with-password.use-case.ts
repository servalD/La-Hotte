import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { normalizeEmail } from '../domain/account';
import { AccountSuspendedError, InvalidCredentialsError } from '../domain/account.errors';
import { AccountRepository, PasswordHasher } from '../domain/account.ports';
import { RateLimiter, SecretTokens, SecurityLog, type SessionRef } from '../domain/ports';
import { type RateLimitSubject, TRUSTED_DEVICE_ACCOUNT_THRESHOLD } from '../domain/rate-limit';
import { PENDING_SECOND_FACTOR_TTL_MS, requiresSecondFactor } from '../domain/second-factor';
import { SecondFactorEnrollmentRequiredError } from '../domain/second-factor.errors';
import { PendingSecondFactors, TrustedDeviceRepository } from '../domain/second-factor.ports';
import { RateLimitedError } from '../domain/session.errors';
import type { ClientInfo } from './client-info';
import { type IssuedSession, SessionLifecycle } from './session-lifecycle';

const NO_ACCOUNT_ID = '00000000-0000-0000-0000-000000000000';

/** Issue d'une connexion : session ouverte, ou second facteur attendu (AUTH-12). */
export type SignInResult =
  | { readonly kind: 'session'; readonly issued: IssuedSession }
  /** Jeton de pré-authentification, à poser dans `__Host-lh_pending` ; jamais stocké en clair. */
  | { readonly kind: 'second_factor'; readonly pendingToken: string };

/**
 * Connexion par mot de passe (AUTH-01, AUTH-07, AUTH-12, AUTH-13, ADR 0013, ADR 0014).
 *
 * - Limitation d'abord : pendant le délai, `429` sans évaluer les identifiants. Clés par e-mail
 *   normalisé, pour toute adresse inscrite ou non : un `429` ne révèle rien. Depuis un appareil
 *   de confiance du compte, seuil par compte relevé à 50 (ADR 0013).
 * - Époque du compte lue **avant** la vérification du mot de passe (ADR 0014).
 * - Compte absent ou sans mot de passe : vérification argon2 factice de même coût, même refus.
 * - TOTP actif : aucune session, une pré-authentification de 5 minutes (Redis seul), sauf depuis
 *   un appareil de confiance du compte (jamais pour un administrateur ou un modérateur).
 * - Navigateur qui avait déjà une session : elle est révoquée côté serveur à l'ouverture de la
 *   nouvelle (rotation).
 */
@Injectable()
export class SignInWithPassword {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly hasher: PasswordHasher,
    private readonly limiter: RateLimiter,
    private readonly lifecycle: SessionLifecycle,
    private readonly devices: TrustedDeviceRepository,
    private readonly pending: PendingSecondFactors,
    private readonly tokens: SecretTokens,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly email: string;
    readonly password: string;
    readonly client: ClientInfo;
    readonly previous: SessionRef | null;
    /** Cookie `__Host-lh_device`, tel que reçu. */
    readonly deviceToken: string | null;
  }): Promise<SignInResult> {
    const email = normalizeEmail(input.email);
    const device = await this.trustedDeviceFor(email, input.deviceToken);
    const subjects: RateLimitSubject[] = [
      { scope: 'login_pair', parts: [email, input.client.ip] },
      {
        scope: 'login_account',
        parts: [email],
        ...(device ? { threshold: TRUSTED_DEVICE_ACCOUNT_THRESHOLD } : {}),
      },
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
    const state = await this.lifecycle.observe(accountId);
    const account = await this.accounts.findById(accountId);
    const valid = await this.hasher.verify(account?.passwordHash ?? null, input.password);

    // AUTH-15 : un compte non vérifié reçoit le même refus qu'un mot de passe faux (sinon une
    // inscription suivie d'une connexion dirait si l'adresse avait déjà un compte).
    if (!account || !valid || !state || !account.emailVerified) {
      await this.limiter.recordFailure(subjects, this.clock.now(), reservation);
      await this.log(account?.accountId ?? null, 'login.failed', input.client);
      throw new InvalidCredentialsError();
    }
    if (!account.active || !state.active) {
      await this.limiter.recordFailure(subjects, this.clock.now(), reservation);
      await this.log(account.accountId, 'login.failed', input.client);
      throw new AccountSuspendedError();
    }
    // Premier facteur réussi : seul le compteur du couple est remis à zéro. Le compteur du second
    // facteur, lui, ne l'est jamais par un mot de passe juste (ADR 0013).
    await this.limiter.recordSuccess(subjects, reservation);

    const privileged = requiresSecondFactor(state.role);
    // AUTH-13 : administrateur ou modérateur sans TOTP, refus en échec fermé.
    if (privileged && !account.totpEnabled) {
      await this.log(account.accountId, 'login.failed', input.client);
      throw new SecondFactorEnrollmentRequiredError();
    }
    const dispensed = device?.accountId === account.accountId && !privileged;
    if (account.totpEnabled && !dispensed) {
      const pendingToken = this.tokens.generate();
      await this.pending.create(
        this.tokens.hash(pendingToken),
        { accountId: account.accountId, epoch: state.epoch, createdAt: this.clock.now() },
        PENDING_SECOND_FACTOR_TTL_MS,
      );
      await this.log(account.accountId, 'login.second_factor_required', input.client);
      return { kind: 'second_factor', pendingToken };
    }

    const issued = await this.lifecycle.create({
      accountId: account.accountId,
      observedEpoch: state.epoch,
      userAgent: input.client.userAgent,
      trustedDeviceId: dispensed ? device.id : null,
      previous: input.previous,
    });
    await this.log(account.accountId, 'login.succeeded', input.client);
    return { kind: 'session', issued };
  }

  /**
   * Appareil de confiance présenté **pour ce compte** (ADR 0013) : refusé s'il est d'un autre
   * compte, révoqué ou expiré. Ne révèle rien : sans cookie valide, le chemin est le même.
   */
  private async trustedDeviceFor(
    email: string,
    deviceToken: string | null,
  ): Promise<{ id: string; accountId: string } | null> {
    if (!deviceToken || !this.tokens.isWellFormed(deviceToken)) return null;
    const device = await this.devices.findActive(this.tokens.hash(deviceToken), this.clock.now());
    if (!device) return null;
    const owner = await this.accounts.findById(device.accountId);
    return owner?.email === email ? device : null;
  }

  private async log(
    accountId: string | null,
    event: 'login.failed' | 'login.succeeded' | 'login.second_factor_required',
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
