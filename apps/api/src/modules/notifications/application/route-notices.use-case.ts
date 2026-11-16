import { Injectable } from '@nestjs/common';
import type { CommentChanged, EventNotice, ProductExtracted } from '../../../shared/domain';
import { FollowRepository } from '../../conversations';
import type { NotificationType } from '../domain/notification';
import { NotificationPeople } from '../domain/notification.ports';
import { ProduceNotifications } from './produce-notifications.use-case';

const EVENT_TYPES: Record<EventNotice['notice'], NotificationType | null> = {
  invited: 'event.invited',
  cancelled: 'event.cancelled',
  reminder: 'event.reminder',
  day_after: 'event.day_after',
  // Phase 5 : seulement pour un participant engagé (port vide d'ici là).
  participant_withdrew: null,
};

const SECURITY_TYPES = {
  pin_reset: 'security.pin_reset',
  login: 'security.login',
  totp_enabled: 'security.totp_enabled',
  totp_disabled: 'security.totp_disabled',
} as const satisfies Record<string, NotificationType>;

/**
 * Traduit les événements de domaine en demandes de notification (NOT-12) ; chaque demande repasse
 * par le moteur, candidat par candidat (NOT-10).
 */
@Injectable()
export class RouteNotices {
  constructor(
    private readonly produce: ProduceNotifications,
    private readonly follows: FollowRepository,
    private readonly people: NotificationPeople,
  ) {}

  /** NOT-02, NOT-12 : abonnés de l'élément ; les mentionnés reçoivent `MENTIONS` à la place. */
  async comment(event: CommentChanged): Promise<void> {
    if (event.kind !== 'MESSAGE' || event.change === 'deleted') return;
    const subject = { kind: 'item' as const, itemId: event.itemId, thread: event.thread };
    if (event.mentionIds.length > 0) {
      await this.produce.execute({
        type: 'comment.mention',
        subject,
        candidates: event.mentionIds,
        actorId: event.authorId,
        commentId: event.commentId,
      });
    }
    if (event.change !== 'created') return;
    const followers = (await this.follows.followersOf(event.itemId)).filter(
      (id) => !event.mentionIds.includes(id),
    );
    await this.produce.execute({
      type: 'comment.created',
      subject,
      candidates: followers,
      actorId: event.authorId,
      commentId: event.commentId,
    });
  }

  /** EVT-13, EVT-15, EVT-32, EVT-34 */
  async event(event: EventNotice): Promise<void> {
    const type = EVENT_TYPES[event.notice];
    if (!type) return;
    await this.produce.execute({
      type,
      subject: { kind: 'event', eventId: event.eventId },
      candidates: event.profileIds,
      actorId: event.actorId,
    });
  }

  /** EXT-06 : à l'auteur de la fiche. */
  async product(event: ProductExtracted): Promise<void> {
    await this.produce.execute({
      type: 'product.extracted',
      subject: { kind: 'product', productId: event.productId },
      candidates: [event.ownerId],
      actorId: null,
    });
  }

  /** NOT-02 : au profil, ou à tous les profils du compte. */
  async security(input: {
    notice: keyof typeof SECURITY_TYPES;
    accountId: string;
    profileId: string | null;
  }): Promise<void> {
    const candidates = input.profileId
      ? [input.profileId]
      : await this.people.profilesOfAccount(input.accountId);
    await this.produce.execute({
      type: SECURITY_TYPES[input.notice],
      subject: { kind: 'self' },
      candidates,
      actorId: null,
    });
  }
}
