import { Injectable } from '@nestjs/common';
import { itemAccess, itemCriteria, VisibilityService } from '../../visibility';
import { itemFactsOf } from '../domain/list';
import {
  EngagementReader,
  EventLookup,
  ItemRepository,
  ListRepository,
} from '../domain/list.ports';
import { ListGate } from './list-gate';
import { eventForParticipant } from './manage-event-lists.use-case';

export interface EventProgress {
  /** EVT-30 : souhaits des listes vues en offreur, et ceux qui ont un offreur. */
  readonly itemsTotal: number;
  readonly itemsWithGiver: number;
  /** EVT-31 : destinataires de ces listes, hors le lecteur. */
  readonly recipients: readonly string[];
  /** EVT-31 : parmi eux, ceux dont aucun élément n'a d'offreur. */
  readonly recipientsWithoutGiver: readonly string[];
}

/**
 * EVT-30, EVT-31, EVT-37 : avancement calculé sur les seules listes de l'événement que le lecteur
 * voit **en offreur** ; une liste dont il est destinataire, même co-destinataire, n'y entre
 * jamais. L'ensemble de départ (listes, destinataires) ne dépend d'aucun état ; seul le compte
 * des offreurs en dépend, et il n'est montré qu'à des offreurs.
 */
@Injectable()
export class GetEventProgress {
  constructor(
    private readonly lists: ListRepository,
    private readonly items: ItemRepository,
    private readonly engagements: EngagementReader,
    private readonly lookup: EventLookup,
    private readonly gate: ListGate,
    private readonly visibility: VisibilityService,
  ) {}

  async execute(input: { viewerId: string; eventId: string }): Promise<EventProgress> {
    await eventForParticipant(this.lookup, input.eventId, input.viewerId);
    const candidates = await this.lists.findCandidates(
      await this.visibility.listCandidates(input.viewerId),
    );
    let itemsTotal = 0;
    let itemsWithGiver = 0;
    const recipients = new Set<string>();
    const served = new Set<string>();
    for (const list of candidates) {
      if (list.event?.id !== input.eventId) continue;
      const { access } = await this.gate.accessOf(input.viewerId, list);
      if (access.kind !== 'giver') continue;
      // Seconde barrière : jamais une liste dont il est destinataire (VIS-20, EVT-37).
      if (list.recipients.includes(input.viewerId)) continue;
      for (const id of list.recipients) recipients.add(id);
      const criteria = itemCriteria(access, input.viewerId);
      if (!criteria) continue;
      for (const row of await this.items.listItems(list.id, criteria, 'position')) {
        if (row.isSuggestion) continue; // EVT-30 : des souhaits, pas des suggestions.
        if (itemAccess(access, itemFactsOf(row), input.viewerId) !== 'giver') continue;
        itemsTotal += 1;
        const engaged =
          row.status === 'RESERVED' ||
          row.status === 'PURCHASED' ||
          (await this.engagements.engagedProfiles(row.id)).length > 0;
        if (!engaged) continue;
        itemsWithGiver += 1;
        for (const id of list.recipients) served.add(id);
      }
    }
    const others = [...recipients].filter((id) => id !== input.viewerId).sort();
    return {
      itemsTotal,
      itemsWithGiver,
      recipients: others,
      recipientsWithoutGiver: others.filter((id) => !served.has(id)),
    };
  }
}
