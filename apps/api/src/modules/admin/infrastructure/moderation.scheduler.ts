import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { EraseRemovedComments } from '../application/moderate-content.use-case';

const INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * MOD-11 : le texte d'un message retiré par la modération est effacé une fois le délai de
 * contestation passé. Dans le processus, sans dommage en double, arrêtée en test.
 */
@Injectable()
export class ModerationScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ModerationScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly erase: EraseRemovedComments,
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
        if (count > 0) this.logger.log({ count }, 'Messages retirés effacés');
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error }, 'Effacement des messages retirés en échec');
        this.errors.report(error, { route: 'task:admin.moderation-erase' });
      })
      .finally(() => {
        this.running = null;
      });
  }
}
