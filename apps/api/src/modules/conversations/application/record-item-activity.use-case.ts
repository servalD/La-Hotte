import { Injectable } from '@nestjs/common';
import { AppEvents, Clock, IdGenerator, type ItemChanged } from '../../../shared/domain';
import { ItemAccessReader } from '../../lists';
import { CommentRepository, FollowRepository } from '../domain/conversation.ports';

/**
 * Réaction de `conversations` aux changements d'élément (ADR 0018) : suivi d'office de l'élément
 * ajouté (NOT-13), activité écrite au fil que décide le moteur (COM-14). Hors de la transaction de
 * l'élément : un arrêt brutal peut perdre l'activité.
 */
@Injectable()
export class RecordItemActivity {
  constructor(
    private readonly reader: ItemAccessReader,
    private readonly comments: CommentRepository,
    private readonly follows: FollowRepository,
    private readonly events: AppEvents,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(event: ItemChanged): Promise<void> {
    if (event.change === 'created' && event.actorId) {
      await this.follows.followByDefault(event.itemId, event.actorId);
    }
    if (!event.activity) return;
    const thread = await this.reader.activityThreadOf(event.itemId, event.actorId);
    if (!thread) return;
    const created = await this.comments.create({
      id: this.ids.next(),
      itemId: event.itemId,
      thread,
      kind: 'ACTIVITY',
      authorId: event.actorId,
      body: '',
      mentionIds: [],
      activity: event.activity,
      at: this.clock.now(),
    });
    this.events.publish({
      type: 'comment.changed',
      itemId: event.itemId,
      thread,
      commentId: created.id,
      change: 'created',
      kind: 'ACTIVITY',
      authorId: event.actorId,
      mentionIds: [],
    });
  }
}
