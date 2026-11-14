import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { SecretTokens, SecurityLog, type SessionRef } from '../domain/ports';
import { TrustedDeviceNotFoundError } from '../domain/second-factor.errors';
import { TrustedDeviceRepository } from '../domain/second-factor.ports';
import type { ClientInfo } from './client-info';
import { SessionLifecycle } from './session-lifecycle';

export interface TrustedDeviceView {
  readonly id: string;
  readonly userAgent: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  /** Appareil de ce navigateur (cookie `__Host-lh_device`). */
  readonly current: boolean;
}

/** Appareils de confiance du compte (AUTH-12), dans l'espace Compte : métadonnées seulement. */
@Injectable()
export class ListTrustedDevices {
  constructor(
    private readonly devices: TrustedDeviceRepository,
    private readonly tokens: SecretTokens,
    private readonly clock: Clock,
  ) {}

  async execute(accountId: string, deviceToken: string | null): Promise<TrustedDeviceView[]> {
    const now = this.clock.now();
    const current =
      deviceToken && this.tokens.isWellFormed(deviceToken)
        ? await this.devices.findActive(this.tokens.hash(deviceToken), now)
        : null;
    const devices = await this.devices.listActive(accountId, now);
    return devices.map((device) => ({ ...device, current: device.id === current?.id }));
  }
}

/**
 * Révocation d'un appareil de confiance (AUTH-12). Les sessions ouvertes grâce à lui sont révoquées
 * aussi : on retire sa confiance à un appareil perdu ou prêté, pas seulement sa prochaine
 * connexion. `404` pour un appareil inconnu comme pour celui d'un autre compte (SEC-04).
 */
@Injectable()
export class RevokeTrustedDevice {
  constructor(
    private readonly devices: TrustedDeviceRepository,
    private readonly lifecycle: SessionLifecycle,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly session: SessionRef;
    readonly deviceId: string;
    readonly client: ClientInfo;
  }): Promise<{ readonly currentSessionRevoked: boolean }> {
    const accountId = input.session.accountId;
    if (!(await this.devices.revoke(accountId, input.deviceId, this.clock.now()))) {
      throw new TrustedDeviceNotFoundError();
    }
    let currentSessionRevoked = false;
    for (const record of await this.lifecycle.list(accountId)) {
      if (record.trustedDeviceId !== input.deviceId) continue;
      await this.lifecycle.revoke({ id: record.id, accountId, tokenHash: record.tokenHash });
      if (record.id === input.session.id) currentSessionRevoked = true;
    }
    await this.securityLog.record({
      accountId,
      event: 'device.revoked',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: this.clock.now(),
    });
    return { currentSessionRevoked };
  }
}
