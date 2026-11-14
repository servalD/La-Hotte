import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { RunDueTransfers } from '../application/contract';

const INTERVAL_MS = 5 * 60 * 1000;

/**
 * PRO-12, PRO-13 : toutes les 5 minutes, les passages arrivés à échéance s'exécutent et les
 * détachements reçoivent leur lien d'installation. Dans le processus, en attendant une file de
 * tâches planifiées ; plusieurs instances peuvent tourner ensemble (chaque exécution verrouille et
 * revérifie la demande). Arrêtée en test : les tests appellent le cas d'usage eux-mêmes.
 */
@Injectable()
export class TransferScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TransferScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly due: RunDueTransfers,
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
    this.running = this.due
      .execute()
      .then((count) => {
        if (count > 0) this.logger.log({ count }, 'Changements de compte traités');
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error }, 'Changements de compte en échec');
        this.errors.report(error, { route: 'task:profile.transfer' });
      })
      .finally(() => {
        this.running = null;
      });
  }
}
