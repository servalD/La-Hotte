import { Injectable } from '@nestjs/common';
import { ProductCatalog } from '../../catalog';
import { EventAccessReader } from '../../events';
import { ItemAccessReader } from '../../lists';
import { threadLevel } from '../../visibility';
import type { NotificationSubject } from '../domain/notification';
import { NotificationSubjects, type SubjectSummary } from '../domain/notification.ports';

/**
 * NOT-10, NOT-11 : chaque sujet est jugé par le moteur, à travers les lecteurs d'accès de `lists` et
 * d'`events` (ADR 0018). Un élément exige que le profil lise le fil de la notification.
 */
@Injectable()
export class EngineNotificationSubjects extends NotificationSubjects {
  constructor(
    private readonly items: ItemAccessReader,
    private readonly events: EventAccessReader,
    private readonly products: ProductCatalog,
  ) {
    super();
  }

  async readers(subject: NotificationSubject, profileIds: readonly string[]): Promise<Set<string>> {
    switch (subject.kind) {
      case 'item': {
        const contexts = await this.items.forViewers(profileIds, subject.itemId);
        return new Set(
          [...contexts].flatMap(([id, context]) =>
            threadLevel(context.threads, subject.thread) === 'none' ? [] : [id],
          ),
        );
      }
      case 'event':
        return this.events.viewers(subject.eventId, profileIds);
      case 'product': {
        const out = new Set<string>();
        for (const id of profileIds) {
          if (await this.products.findOwned(id, subject.productId)) out.add(id);
        }
        return out;
      }
      case 'self':
        return new Set(profileIds);
    }
  }

  async describe(subject: NotificationSubject, profileId: string): Promise<SubjectSummary | null> {
    switch (subject.kind) {
      case 'item': {
        const summary = await this.items.summary(profileId, subject.itemId);
        if (!summary || threadLevel(summary.threads, subject.thread) === 'none') return null;
        return { title: summary.itemTitle, context: summary.listTitle, listId: summary.listId };
      }
      case 'event': {
        const title = await this.events.title(profileId, subject.eventId);
        return title === null ? null : { title, context: null, listId: null };
      }
      case 'product': {
        const product = await this.products.findOwned(profileId, subject.productId);
        return product ? { title: product.title, context: null, listId: null } : null;
      }
      case 'self':
        return { title: null, context: null, listId: null };
    }
  }
}
