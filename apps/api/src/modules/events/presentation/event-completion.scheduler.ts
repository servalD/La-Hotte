import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { CompleteEvents } from '../application/contract';

const INTERVAL_MS = 60 * 60 * 1000;

/**
 * EVT-33 : passage horaire à `DONE` des événements 30 jours après leur date. Comme la purge de la
 * corbeille : dans le processus, sans dommage si plusieurs instances la lancent, arrêtée en test.
 */
@Injectable()
export class EventCompletionScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EventCompletionScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly complete: CompleteEvents,
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
    this.running = this.complete
      .execute()
      .then((count) => {
        if (count > 0) this.logger.log({ count }, 'Événements terminés');
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error }, 'Clôture des événements en échec');
        this.errors.report(error, { route: 'task:event.complete' });
      })
      .finally(() => {
        this.running = null;
      });
  }
}
