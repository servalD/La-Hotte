import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { PurgeListTrash } from '../application/contract';

const INTERVAL_MS = 60 * 60 * 1000;

/**
 * LST-20 : purge horaire des listes à la corbeille depuis 30 jours. Comme la purge des comptes non
 * vérifiés : dans le processus, sans dommage si plusieurs instances la lancent, arrêtée en test.
 */
@Injectable()
export class TrashPurgeScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TrashPurgeScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly purge: PurgeListTrash,
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
        if (count > 0) this.logger.log({ count }, 'Listes purgées de la corbeille');
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error }, 'Purge de la corbeille en échec');
        this.errors.report(error, { route: 'task:list.purge' });
      })
      .finally(() => {
        this.running = null;
      });
  }
}
