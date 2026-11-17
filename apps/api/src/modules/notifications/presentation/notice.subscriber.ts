import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { AppEvents } from '../../../shared/domain';
import { IdentityEvents } from '../../identity';
import { PurgeNotifications, RouteNotices } from '../application/contract';

/**
 * Abonné aux bus de domaine (ADR 0018) : commentaires, avis d'événement, extraction, avis de
 * sécurité → demandes de notification, chacune revérifiée par le moteur (NOT-10).
 */
@Injectable()
export class NoticeSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly stops: (() => void)[] = [];

  constructor(
    private readonly events: AppEvents,
    private readonly identity: IdentityEvents,
    private readonly route: RouteNotices,
    private readonly errors: ErrorReporter,
  ) {}

  onModuleInit(): void {
    this.stops.push(
      this.events.subscribe(async (event) => {
        switch (event.type) {
          case 'comment.changed':
            return this.route.comment(event);
          case 'event.notice':
            return this.route.event(event);
          case 'product.extracted':
            return this.route.product(event);
          case 'accounting.changed':
            return this.route.accounting(event);
          default:
            return undefined;
        }
      }),
      this.identity.subscribe((event) => {
        if (event.type !== 'security.notice') return;
        this.route
          .security({
            notice: event.notice,
            accountId: event.accountId,
            profileId: event.profileId,
          })
          .catch((error: unknown) => {
            this.errors.report(error, { route: 'event:security.notice' });
          });
      }),
    );
  }

  onModuleDestroy(): void {
    for (const stop of this.stops) stop();
  }
}

const DAY_MS = 24 * 3600_000;

/** NOT-18 : purge quotidienne, comme celle de la corbeille ; arrêtée en test. */
@Injectable()
export class NotificationPurgeScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationPurgeScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly purge: PurgeNotifications,
    private readonly errors: ErrorReporter,
    config: AppConfig,
  ) {
    this.enabled = config.env.NODE_ENV !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.purge
        .execute()
        .then((count) => {
          if (count > 0) this.logger.log({ count }, 'Notifications purgées');
        })
        .catch((error: unknown) => {
          this.errors.report(error, { route: 'task:notification.purge' });
        })
        .finally(() => {
          this.running = null;
        });
    }, DAY_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
