import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { EventThrottle, SecurityLog } from '../domain/ports';

/** Une ligne au plus par adresse et par minute. */
const CSRF_LOG_WINDOW_MS = 60_000;

/**
 * SEC-30 : refus CSRF inscrit au journal de sécurité, une ligne par minute au plus pour chaque
 * couple (adresse, compte visé ou anonyme), pour qu'un anonyme ne remplisse pas une table en
 * ajout seul (DAT-02) sans fusionner les refus de comptes différents.
 */
@Injectable()
export class ReportCsrfRejection {
  constructor(
    private readonly securityLog: SecurityLog,
    private readonly throttle: EventThrottle,
    private readonly clock: Clock,
  ) {}

  async execute(input: { accountId: string | null; ip: string; userAgent: string }): Promise<void> {
    if (
      !(await this.throttle.firstInWindow(
        ['csrf.rejected', input.ip, input.accountId ?? 'anonyme'],
        CSRF_LOG_WINDOW_MS,
      ))
    ) {
      return;
    }
    await this.securityLog.record({ ...input, event: 'csrf.rejected', at: this.clock.now() });
  }
}
