import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { EraseDueAccounts, HandleInactiveAccounts } from '../application/contract';

const INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * RGPD-12, RGPD-13 : effacements échus et comptes inactifs, toutes les six heures. Dans le
 * processus, sans dommage en double (chaque étape revérifie l'état sous verrou), arrêtée en test.
 */
@Injectable()
export class AccountLifecycleScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AccountLifecycleScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly erase: EraseDueAccounts,
    private readonly inactive: HandleInactiveAccounts,
    private readonly errors: ErrorReporter,
    config: AppConfig,
  ) {
    this.enabled = config.env.NODE_ENV !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      this.tick();
    }, INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  private tick(): void {
    if (this.running) return;
    this.running = (async () => {
      const { warned, scheduled } = await this.inactive.execute();
      const erased = await this.erase.execute();
      if (warned + scheduled + erased > 0) {
        this.logger.log({ warned, scheduled, erased }, 'Cycle de vie des comptes');
      }
    })()
      .catch((error: unknown) => {
        this.logger.error({ err: error }, 'Cycle de vie des comptes en échec');
        this.errors.report(error, { route: 'task:account.lifecycle' });
      })
      .finally(() => {
        this.running = null;
      });
  }
}
