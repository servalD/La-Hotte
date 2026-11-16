import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { DeliverPushes, SendDigests } from '../application/contract';

const PUSH_INTERVAL_MS = 30 * 1000;
const DIGEST_INTERVAL_MS = 60 * 60 * 1000;

/**
 * NOT-14, NOT-15, NOT-17 (ADR 0018) : push dues toutes les 30 secondes, résumés chaque heure, dans
 * le processus ; plusieurs instances se partagent le travail par réclamation en base. Arrêté en test.
 */
@Injectable()
export class DeliveryScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DeliveryScheduler.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Map<string, Promise<void>>();
  private readonly enabled: boolean;

  constructor(
    private readonly pushes: DeliverPushes,
    private readonly digests: SendDigests,
    private readonly errors: ErrorReporter,
    config: AppConfig,
  ) {
    this.enabled = config.env.NODE_ENV !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.every('push', PUSH_INTERVAL_MS, () => this.pushes.execute());
    this.every('digest', DIGEST_INTERVAL_MS, () => this.digests.execute());
  }

  private every(name: string, ms: number, task: () => Promise<number>): void {
    const timer = setInterval(() => {
      if (this.running.has(name)) return;
      const run = task()
        .then((count) => {
          if (count > 0) this.logger.log({ task: name, count }, 'Envois faits');
        })
        .catch((error: unknown) => {
          this.logger.error({ err: error, task: name }, 'Envois en échec');
          this.errors.report(error, { route: `task:notification.${name}` });
        })
        .finally(() => {
          this.running.delete(name);
        });
      this.running.set(name, run);
    }, ms);
    timer.unref();
    this.timers.push(timer);
  }

  async onApplicationShutdown(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    await Promise.allSettled([...this.running.values()]);
  }
}
