import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { NOTIFICATION_RETENTION_DAYS } from '../domain/notification';
import { NotificationRepository } from '../domain/notification.ports';

/** NOT-18 : purge des notifications de plus de 90 jours. */
@Injectable()
export class PurgeNotifications {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly clock: Clock,
  ) {}

  execute(): Promise<number> {
    const before = new Date(
      this.clock.now().getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 3600_000,
    );
    return this.notifications.purgeBefore(before);
  }
}
