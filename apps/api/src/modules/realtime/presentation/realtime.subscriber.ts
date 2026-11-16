import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import { AppEvents } from '../../../shared/domain';
import { IdentityEvents } from '../../identity';
import { RealtimeDispatcher } from '../application/realtime-dispatcher';

/** Abonné aux bus de domaine (ADR 0018) : chaque événement devient des trames, socket par socket. */
@Injectable()
export class RealtimeSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly stops: (() => void)[] = [];

  constructor(
    private readonly events: AppEvents,
    private readonly identity: IdentityEvents,
    private readonly dispatcher: RealtimeDispatcher,
    private readonly errors: ErrorReporter,
  ) {}

  onModuleInit(): void {
    this.stops.push(
      this.events.subscribe(async (event) => {
        switch (event.type) {
          case 'item.changed':
            return this.dispatcher.itemChanged(event);
          case 'list.changed':
            return this.dispatcher.listChanged(event);
          case 'comment.changed':
            return this.dispatcher.commentChanged(event);
          case 'event.changed':
            return this.dispatcher.eventChanged(event);
          case 'notification.created':
            return this.dispatcher.notificationCreated(event);
          case 'product.extracted':
            return this.dispatcher.productExtracted(event);
          default:
            return undefined;
        }
      }),
      this.identity.subscribe((event) => {
        const run = (): Promise<void> => {
          switch (event.type) {
            case 'session.revoked':
            case 'profile.locked':
            case 'session.profile_changed':
              return this.dispatcher.closeSession(event.sessionId);
            case 'circle.changed':
              return this.dispatcher.recheckAll();
            default:
              return Promise.resolve();
          }
        };
        run().catch((error: unknown) => {
          this.errors.report(error, { route: `event:${event.type}` });
        });
      }),
    );
  }

  onModuleDestroy(): void {
    for (const stop of this.stops) stop();
  }
}
