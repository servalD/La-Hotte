import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { type EventAccess, eventAccess, type EventFacts } from '../../visibility';
import { eventFactsOf, type EventRecord } from '../domain/event';
import { isDayPassed } from '../domain/event-date';
import { EventNotFoundError } from '../domain/event.errors';
import { EventRepository } from '../domain/event.ports';

export interface GatedEvent {
  readonly event: EventRecord;
  readonly facts: EventFacts;
  readonly access: Exclude<EventAccess, { kind: 'none' }>;
}

/**
 * Entrée de toute lecture et de toute action sur un événement (VIS-34, VIS-36) : charge les faits,
 * demande la décision à `visibility`, et répond `404` comme pour un identifiant inconnu si le
 * profil n'y a pas de ligne (l'honoré d'une surprise compris).
 */
@Injectable()
export class EventGate {
  constructor(
    private readonly events: EventRepository,
    private readonly clock: Clock,
  ) {}

  facts(event: EventRecord): EventFacts {
    return eventFactsOf(event, isDayPassed(event.date, event.timezone, this.clock.now()));
  }

  accessOf(viewerId: string, event: EventRecord): GatedEvent | null {
    const facts = this.facts(event);
    const access = eventAccess(facts, viewerId);
    return access.kind === 'none' ? null : { event, facts, access };
  }

  async event(viewerId: string, eventId: string): Promise<GatedEvent> {
    const event = await this.events.find(eventId);
    const gated = event ? this.accessOf(viewerId, event) : null;
    if (!gated) throw new EventNotFoundError();
    return gated;
  }
}
