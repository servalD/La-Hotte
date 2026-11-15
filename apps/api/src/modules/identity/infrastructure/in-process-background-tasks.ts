import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { BackgroundTasks, IdentitySettings } from '../domain/account.ports';
import type { RegistrationMode } from '../domain/account';

/**
 * Tâches lancées après la réponse, dans le processus (ADR 0013). Une file persistante (BullMQ)
 * pourra la remplacer derrière le même port ; d'ici là, un arrêt propre attend les tâches en
 * cours. Une tâche en échec est journalisée et signalée sans contenu (OBS-25, `scrub`).
 */
@Injectable()
export class InProcessBackgroundTasks extends BackgroundTasks implements OnApplicationShutdown {
  private readonly logger = new Logger(InProcessBackgroundTasks.name);
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly errors: ErrorReporter) {
    super();
  }

  run(name: string, task: () => Promise<void>): void {
    const promise = new Promise<void>((resolve) => setImmediate(resolve))
      .then(task)
      .catch((error: unknown) => {
        this.logger.error({ err: error, task: name }, 'Tâche de fond en échec');
        this.errors.report(error, { route: `task:${name}` });
      })
      .finally(() => {
        this.running.delete(promise);
      });
    this.running.add(promise);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.running]);
  }
}

/** Réglages du module, lus dans la configuration validée au démarrage. */
@Injectable()
export class EnvIdentitySettings extends IdentitySettings {
  readonly registrationMode: RegistrationMode;
  readonly webOrigin: string;

  constructor(config: AppConfig) {
    super();
    this.registrationMode = config.env.REGISTRATION_MODE;
    this.webOrigin = config.env.WEB_ORIGIN.replace(/\/+$/, '');
  }
}
