import { Injectable } from '@nestjs/common';
import type {
  AccountingChanged,
  CommentChanged,
  EventNotice,
  ProductExtracted,
} from '../../../shared/domain';
import { FollowRepository } from '../../conversations';
import type { NotificationType } from '../domain/notification';
import { NotificationPeople } from '../domain/notification.ports';
import { ProduceNotifications } from './produce-notifications.use-case';

const EVENT_TYPES: Record<EventNotice['notice'], NotificationType | null> = {
  invited: 'event.invited',
  cancelled: 'event.cancelled',
  reminder: 'event.reminder',
  day_after: 'event.day_after',
  // Critère de 05 : publié pour un participant engagé seulement (phase 5).
  participant_withdrew: 'event.participant_withdrew',
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

  /**
   * Avis de compta (NOT-12, 07). Candidats tirés des seuls participants et de l'acheteur portés
   * par l'avis ; chacun repasse par le moteur sous la forme offreur (fil Offreurs, CPT-59, NOT-05).
   * CPT-19 : un reste ne va qu'aux personnes choisies par son auteur.
   */
  async accounting(event: AccountingChanged): Promise<void> {
    if (event.itemId === null) return;
    const others = event.participantIds.filter((id) => id !== event.actorId);
    const buyer = event.buyerId && event.buyerId !== event.actorId ? [event.buyerId] : [];
    const route: Partial<
      Record<AccountingChanged['change'], [NotificationType, readonly string[]]>
    > = {
      joined: ['gift.joined', others],
      purchased: ['gift.purchased', others],
      unchecked: ['gift.unchecked', others],
      review_opened: ['gift.review', others],
      buyer_requested: ['gift.buyer_request', buyer],
      shortfall: [
        'gift.shortfall',
        (event.profileIds ?? []).filter((id) => event.participantIds.includes(id)),
      ],
      settlement_claimed: ['gift.settlement_claimed', buyer],
      settlement_nudged: [
        'gift.settlement_reminder',
        (event.profileIds ?? []).filter((id) => event.participantIds.includes(id)),
      ],
    };
    const target = route[event.change];
    if (!target || target[1].length === 0) return;
    await this.produce.execute({
      type: target[0],
      subject: { kind: 'item', itemId: event.itemId, thread: 'GIVERS' },
      candidates: target[1],
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
