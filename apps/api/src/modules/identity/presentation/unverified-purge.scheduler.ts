import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { PurgeUnverifiedAccounts } from '../application/contract';

const INTERVAL_MS = 60 * 60 * 1000;

/**
 * AUTH-15 : purge horaire des comptes non vérifiés depuis 7 jours. Dans le processus, en attendant
 * une file de tâches planifiées ; plusieurs instances peuvent la lancer en même temps sans dommage
 * (chaque étape revérifie l'état du compte). Arrêtée en test : les tests appellent le cas
 * d'usage eux-mêmes.
 */
@Injectable()
export class UnverifiedPurgeScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(UnverifiedPurgeScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly purge: PurgeUnverifiedAccounts,
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
    this.running = this.purge
      .execute()
      .then((count) => {
        if (count > 0) this.logger.log({ count }, 'Comptes non vérifiés supprimés');
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error }, 'Purge des comptes non vérifiés en échec');
        this.errors.report(error, { route: 'task:account.purge' });
      })
      .finally(() => {
        this.running = null;
      });
  }
}
