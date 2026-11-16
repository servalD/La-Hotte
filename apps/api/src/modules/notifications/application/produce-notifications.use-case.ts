import { Injectable } from '@nestjs/common';
import { AppEvents, Clock, IdGenerator } from '../../../shared/domain';
import {
  channelEnabled,
  NOTIFICATION_TYPES,
  type NotificationSubject,
  type NotificationType,
  pushDueAt,
} from '../domain/notification';
import {
  NotificationPeople,
  NotificationRepository,
  NotificationSubjects,
  PreferenceRepository,
} from '../domain/notification.ports';

export interface NotificationRequest {
  readonly type: NotificationType;
  readonly subject: NotificationSubject;
  /** NOT-10 : candidats ; le moteur décide qui reçoit. */
  readonly candidates: readonly string[];
  readonly actorId: string | null;
  readonly commentId?: string | null;
}

/**
 * NOT-05, NOT-10 : une notification par candidat qui lit le sujet sous la forme requise, jamais à
 * l'auteur du geste. La push est programmée si le canal est actif (NOT-04), à la fin des heures
 * calmes (NOT-14). Rien n'est écrit pour un candidat dont aucun canal n'est actif.
 */
@Injectable()
export class ProduceNotifications {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly preferences: PreferenceRepository,
    private readonly subjects: NotificationSubjects,
    private readonly people: NotificationPeople,
    private readonly events: AppEvents,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(request: NotificationRequest): Promise<number> {
    const category = NOTIFICATION_TYPES[request.type];
    const candidates = [...new Set(request.candidates)].filter((id) => id !== request.actorId);
    if (candidates.length === 0) return 0;
    const readers = await this.subjects.readers(request.subject, candidates);
    let written = 0;
    for (const profileId of candidates) {
      if (!readers.has(profileId)) continue;
      const overrides = await this.preferences.overrides(profileId);
      const enabled = (['IN_APP', 'PUSH', 'EMAIL'] as const).filter((channel) =>
        channelEnabled(overrides, category, channel),
      );
      if (enabled.length === 0) continue;
      const now = this.clock.now();
      let due: Date | null = null;
      if (enabled.includes('PUSH')) {
        const settings = await this.preferences.settings(profileId);
        const timezone = (await this.people.timezoneOf(profileId)) ?? 'UTC';
        due = pushDueAt(now, settings, timezone);
      }
      const created = await this.notifications.create({
        id: this.ids.next(),
        profileId,
        type: request.type,
        category,
        subject: request.subject,
        commentId: request.commentId ?? null,
        actorId: request.actorId,
        pushDueAt: due,
        at: now,
      });
      written += 1;
      this.events.publish({
        type: 'notification.created',
        profileId,
        notificationId: created.id,
        seq: created.seq,
      });
    }
    return written;
  }
}
