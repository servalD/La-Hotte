import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Clock } from '../../shared/domain';
import { AppConfig } from '../config/env';
import { ErrorReporter } from '../telemetry/error-reporter';
import { IdempotencyStore } from './idempotency';

const INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * API-16, CPT-71 (suite M4 de la revue de la phase 5) : les clés d'idempotence échues, et les
 * réponses qu'elles gardent, sont effacées. Dans le processus, sans dommage en double, arrêtée en
 * test.
 */
@Injectable()
export class IdempotencyPurgeScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IdempotencyPurgeScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly store: IdempotencyStore,
    private readonly clock: Clock,
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
    this.running = this.store
      .purgeExpired(this.clock.now())
      .then((count) => {
        if (count > 0) this.logger.log({ count }, 'Clés d’idempotence échues effacées');
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error }, 'Purge des clés d’idempotence en échec');
        this.errors.report(error, { route: 'task:platform.idempotency-purge' });
      })
      .finally(() => {
        this.running = null;
      });
  }
}
