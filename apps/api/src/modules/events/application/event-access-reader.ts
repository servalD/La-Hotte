import { Injectable } from '@nestjs/common';
import { EventRepository } from '../domain/event.ports';
import { EventGate } from './event-gate';

/**
 * Lecteur d'accès exposé aux modules `notifications` et `realtime` (ADR 0018) : la décision du
 * moteur (VIS-36) pour un ou plusieurs profils. L'honoré d'une surprise n'y a jamais accès.
 */
@Injectable()
export class EventAccessReader {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
  ) {}

  /** Profils, parmi ceux donnés, qui voient l'événement. */
  async viewers(eventId: string, profileIds: readonly string[]): Promise<Set<string>> {
    const event = await this.events.find(eventId);
    const seen = new Set<string>();
    if (!event) return seen;
    for (const id of new Set(profileIds)) if (this.gate.accessOf(id, event)) seen.add(id);
    return seen;
  }

  /** NOT-11 : titre d'un événement vu par ce profil, ou `null`. */
  async title(viewerId: string, eventId: string): Promise<string | null> {
    const event = await this.events.find(eventId);
    return event && this.gate.accessOf(viewerId, event) ? event.title : null;
  }
}
