import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { PurgeProfileExports } from '../application/export-profile-data.use-case';

const INTERVAL_MS = 60 * 60 * 1000;

/**
 * RGPD-11 : les fichiers d'export échus sont effacés. Dans le processus, sans dommage en double,
 * arrêtée en test.
 */
@Injectable()
export class ExportPurgeScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ExportPurgeScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly erase: PurgeProfileExports,
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
    this.running = this.erase
      .execute()
      .then((count) => {
        if (count > 0) this.logger.log({ count }, 'Exports échus effacés');
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error }, 'Purge des exports en échec');
        this.errors.report(error, { route: 'task:privacy.export-purge' });
      })
      .finally(() => {
        this.running = null;
      });
  }
}
