import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { type AppEvent, type AppEventListener, AppEvents } from '../../shared/domain';
import { ErrorReporter } from '../telemetry/error-reporter';

/**
 * Bus d'événements dans le processus (ADR 0018). Chaque abonné reçoit l'événement après la fin de
 * la requête en cours (`setImmediate`) ; une erreur d'abonné est journalisée et signalée sans
 * toucher aux autres. `drain()` attend les livraisons en cours (tests, arrêt).
 */
@Injectable()
export class InProcessAppEvents extends AppEvents implements OnApplicationShutdown {
  private readonly logger = new Logger(InProcessAppEvents.name);
  private readonly listeners = new Set<AppEventListener>();
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly errors: ErrorReporter) {
    super();
  }

  publish(event: AppEvent): void {
    for (const listener of this.listeners) {
      const delivery = new Promise<void>((resolve) => setImmediate(resolve))
        .then(() => listener(event))
        .catch((error: unknown) => {
          this.logger.error({ err: error, event: event.type }, 'Abonné en échec');
          this.errors.report(error, { route: `event:${event.type}` });
        })
        .finally(() => {
          this.pending.delete(delivery);
        });
      this.pending.add(delivery);
    }
  }

  subscribe(listener: AppEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Attend toutes les livraisons, y compris celles que publient les abonnés eux-mêmes. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }
}
