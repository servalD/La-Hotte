import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import { RateLimiter, SecretTokens, SecurityLog, type SessionRef } from '../domain/ports';
import {
  parseSecondFactorCode,
  requiresSecondFactor,
  TRUSTED_DEVICE_LIFETIME_MS,
} from '../domain/second-factor';
import { InvalidSecondFactorError, SecondFactorExpiredError } from '../domain/second-factor.errors';
import { PendingSecondFactors, TrustedDeviceRepository } from '../domain/second-factor.ports';
import { RateLimitedError } from '../domain/session.errors';
import type { ClientInfo } from './client-info';
import { SecondFactorVerifier } from './second-factor-verifier';
import { type IssuedSession, SessionLifecycle } from './session-lifecycle';

const USER_AGENT_MAX = 512;

export interface SecondFactorOutcome {
  readonly issued: IssuedSession;
  /** Jeton d'appareil de confiance à poser dans `__Host-lh_device` ; jamais stocké en clair. */
  readonly deviceToken: string | null;
}

/**
 * Second facteur à la connexion (AUTH-10 à AUTH-12, ADR 0013 « Pré-authentification »).
 *
 * - Compteur d'échecs **par compte seul**, seuil 5, remis à zéro par un succès du second facteur
 *   seulement : recommencer le mot de passe, ou changer d'adresse IP, ne donne aucun essai de plus.
 * - La pré-authentification survit à un code faux (elle expire en 5 minutes) ; elle porte
 *   l'époque du compte, qu'une réinitialisation du mot de passe change.
 * - Au succès, elle est consommée atomiquement : une seule session en sort.
 */
@Injectable()
export class VerifySecondFactor {
  constructor(
    private readonly pending: PendingSecondFactors,
    private readonly verifier: SecondFactorVerifier,
    private readonly devices: TrustedDeviceRepository,
    private readonly limiter: RateLimiter,
    private readonly lifecycle: SessionLifecycle,
    private readonly tokens: SecretTokens,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Pré-authentification en cours pour ce cookie (`GET /session`). */
  async isPending(pendingToken: string | null): Promise<boolean> {
    if (!pendingToken || !this.tokens.isWellFormed(pendingToken)) return false;
    return (await this.pending.find(this.tokens.hash(pendingToken))) !== null;
  }

  async execute(input: {
    readonly pendingToken: string | null;
    readonly code: string;
    readonly trustDevice: boolean;
    readonly client: ClientInfo;
    readonly previous: SessionRef | null;
  }): Promise<SecondFactorOutcome> {
    if (!input.pendingToken || !this.tokens.isWellFormed(input.pendingToken)) {
      throw new SecondFactorExpiredError();
    }
    const pendingHash = this.tokens.hash(input.pendingToken);
    const pending = await this.pending.find(pendingHash);
    if (!pending) throw new SecondFactorExpiredError();
    const { accountId } = pending;

    const subjects = [{ scope: 'second_factor' as const, parts: [accountId] }];
    const check = await this.limiter.check(subjects, this.clock.now());
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);

    // Époque changée (réinitialisation, désactivation du TOTP…) ou compte suspendu : la
    // pré-authentification ne vaut plus rien. La réservation expire seule, sans compter d'échec.
    const state = await this.lifecycle.observe(accountId);
    if (!state?.active || state.epoch !== pending.epoch) {
      await this.pending.consume(pendingHash);
      throw new SecondFactorExpiredError();
    }

    const code = parseSecondFactorCode(input.code);
    const used = code ? await this.verifier.verify(accountId, code) : null;
    if (!used) {
      const [failures = 0] = await this.limiter.recordFailure(
        subjects,
        this.clock.now(),
        check.reservation,
      );
      await this.verifier.noteFailures(accountId, failures);
      await this.log(accountId, 'totp.failed', input.client);
      throw new InvalidSecondFactorError();
    }
    await this.limiter.recordSuccess(subjects, check.reservation);
    // Deux vérifications concurrentes justes (code TOTP et code de secours) : une seule session.
    if (!(await this.pending.consume(pendingHash))) throw new SecondFactorExpiredError();

    if (used === 'recovery') await this.log(accountId, 'recovery.code_used', input.client);

    // AUTH-12 : jamais pour un administrateur ou un modérateur (AUTH-13).
    const trusted =
      input.trustDevice && !requiresSecondFactor(state.role)
        ? await this.trustDevice(accountId, input.client)
        : null;
    let issued: IssuedSession;
    try {
      issued = await this.lifecycle.create({
        accountId,
        observedEpoch: pending.epoch,
        userAgent: input.client.userAgent,
        trustedDeviceId: trusted?.id ?? null,
        previous: input.previous,
      });
    } catch (error) {
      if (trusted) await this.devices.revoke(accountId, trusted.id, this.clock.now());
      throw error;
    }
    await this.log(accountId, 'login.succeeded', input.client);
    return { issued, deviceToken: trusted?.token ?? null };
  }

  private async trustDevice(
    accountId: string,
    client: ClientInfo,
  ): Promise<{ id: string; token: string }> {
    const token = this.tokens.generate();
    const now = this.clock.now();
    const id = this.ids.next();
    await this.devices.create({
      id,
      accountId,
      tokenHash: this.tokens.hash(token),
      userAgent: client.userAgent.slice(0, USER_AGENT_MAX),
      createdAt: now,
      expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_LIFETIME_MS),
    });
    await this.log(accountId, 'device.trusted', client);
    return { id, token };
  }

  private async log(
    accountId: string,
    event: 'totp.failed' | 'login.succeeded' | 'recovery.code_used' | 'device.trusted',
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
