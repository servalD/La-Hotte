import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { SendEventReminders } from '../application/contract';

const INTERVAL_MS = 60 * 60 * 1000;

/** EVT-13, EVT-32 : rappels horaires, comme la clôture des événements ; arrêtés en test. */
@Injectable()
export class EventReminderScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EventReminderScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly reminders: SendEventReminders,
    private readonly errors: ErrorReporter,
    config: AppConfig,
  ) {
    this.enabled = config.env.NODE_ENV !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.reminders
        .execute()
        .then((count) => {
          if (count > 0) this.logger.log({ count }, 'Rappels d’événements envoyés');
        })
        .catch((error: unknown) => {
          this.logger.error({ err: error }, 'Rappels d’événements en échec');
          this.errors.report(error, { route: 'task:event.remind' });
        })
        .finally(() => {
          this.running = null;
        });
    }, INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
