import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { SecurityLog } from '../domain/ports';
import { TotpNotEnabledError } from '../domain/second-factor.errors';
import { SecondFactorRepository } from '../domain/second-factor.ports';
import type { ClientInfo } from './client-info';
import { SecondFactorVerifier } from './second-factor-verifier';

/**
 * Nouveaux codes de secours (AUTH-10 ; ré-authentification vérifiée par la garde, AUTH-14) : les
 * anciens sont tous invalidés, les nouveaux affichés une seule fois.
 */
@Injectable()
export class RegenerateRecoveryCodes {
  constructor(
    private readonly secondFactors: SecondFactorRepository,
    private readonly verifier: SecondFactorVerifier,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly client: ClientInfo;
  }): Promise<{ readonly recoveryCodes: string[] }> {
    const { codes, hashes } = this.verifier.newRecoveryCodes();
    const replaced = await this.secondFactors.replaceRecoveryCodes(
      input.accountId,
      hashes,
      this.clock.now(),
    );
    if (!replaced) throw new TotpNotEnabledError();
    await this.securityLog.record({
      accountId: input.accountId,
      event: 'recovery.codes_regenerated',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: this.clock.now(),
    });
    return { recoveryCodes: codes };
  }
}
