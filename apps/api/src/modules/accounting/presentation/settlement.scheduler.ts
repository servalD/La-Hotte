import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { RunSettlementTasks } from '../application/contract';

const INTERVAL_MS = 60 * 60 * 1000;

/**
 * CPT-23, CPT-64, CPT-66 : passage horaire des rappels de part et du reste non couvert. Dans le
 * processus, sans dommage si plusieurs instances la lancent (réclamation en base), arrêtée en test.
 */
@Injectable()
export class SettlementScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SettlementScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly tasks: RunSettlementTasks,
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
    this.running = this.tasks
      .execute()
      .then(({ reminders, absorbed }) => {
        if (reminders + absorbed > 0)
          this.logger.log({ reminders, absorbed }, 'Compta : tâches faites');
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error }, 'Tâches de compta en échec');
        this.errors.report(error, { route: 'task:accounting.settlements' });
      })
      .finally(() => {
        this.running = null;
      });
  }
}
