import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { type AccountAuthState, SecretTokens, SecurityLog, type SessionRef } from '../domain/ports';
import { PENDING_SECOND_FACTOR_TTL_MS, requiresSecondFactor } from '../domain/second-factor';
import { SecondFactorEnrollmentRequiredError } from '../domain/second-factor.errors';
import { PendingSecondFactors, TrustedDeviceRepository } from '../domain/second-factor.ports';
import type { ClientInfo } from './client-info';
import { type IssuedSession, SessionLifecycle } from './session-lifecycle';

/** Issue d'une connexion : session ouverte, ou second facteur attendu (AUTH-12). */
export type SignInResult =
  | { readonly kind: 'session'; readonly issued: IssuedSession }
  /** Jeton de pré-authentification, à poser dans `__Host-lh_pending` ; jamais stocké en clair. */
  | { readonly kind: 'second_factor'; readonly pendingToken: string };

/**
 * Fin d'une connexion dont le premier facteur (mot de passe ou Google) est validé (AUTH-12,
 * AUTH-13, ADR 0013) : la même pour les deux moyens, pour que Google ne contourne ni le TOTP ni
 * l'obligation des rôles privilégiés.
 *
 * - Administrateur ou modérateur sans TOTP : refus en échec fermé.
 * - TOTP actif : aucune session, une pré-authentification de 5 minutes (Redis seul), sauf depuis
 *   un appareil de confiance **du compte** (jamais pour un administrateur ou un modérateur).
 * - Sinon, session neuve à l'époque observée avant la vérification du premier facteur
 *   (ADR 0014) ; l'ancienne session du navigateur est révoquée (rotation).
 */
@Injectable()
export class SignInCompletion {
  constructor(
    private readonly lifecycle: SessionLifecycle,
    private readonly devices: TrustedDeviceRepository,
    private readonly pending: PendingSecondFactors,
    private readonly tokens: SecretTokens,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  /**
   * Appareil de confiance actif désigné par le cookie, ou `null`. Le propriétaire est comparé par
   * l'appelant : un appareil d'un autre compte ne dispense de rien.
   */
  async trustedDevice(
    deviceToken: string | null,
  ): Promise<{ readonly id: string; readonly accountId: string } | null> {
    if (!deviceToken || !this.tokens.isWellFormed(deviceToken)) return null;
    return this.devices.findActive(this.tokens.hash(deviceToken), this.clock.now());
  }

  async complete(input: {
    readonly state: AccountAuthState;
    readonly totpEnabled: boolean;
    /** Appareil de confiance présenté, déjà vérifié comme appartenant à ce compte. */
    readonly deviceId: string | null;
    readonly client: ClientInfo;
    readonly previous: SessionRef | null;
  }): Promise<SignInResult> {
    const accountId = input.state.accountId;
    const privileged = requiresSecondFactor(input.state.role);
    // AUTH-13 : administrateur ou modérateur sans TOTP, refus en échec fermé.
    if (privileged && !input.totpEnabled) {
      await this.log(accountId, 'login.failed', input.client);
      throw new SecondFactorEnrollmentRequiredError();
    }
    const dispensingDevice = privileged ? null : input.deviceId;
    if (input.totpEnabled && !dispensingDevice) {
      const pendingToken = this.tokens.generate();
      await this.pending.create(
        this.tokens.hash(pendingToken),
        { accountId, epoch: input.state.epoch, createdAt: this.clock.now() },
        PENDING_SECOND_FACTOR_TTL_MS,
      );
      await this.log(accountId, 'login.second_factor_required', input.client);
      return { kind: 'second_factor', pendingToken };
    }

    const issued = await this.lifecycle.create({
      accountId,
      observedEpoch: input.state.epoch,
      userAgent: input.client.userAgent,
      trustedDeviceId: dispensingDevice,
      previous: input.previous,
    });
    await this.log(accountId, 'login.succeeded', input.client);
    return { kind: 'session', issued };
  }

  private async log(
    accountId: string,
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
