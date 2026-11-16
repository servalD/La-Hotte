import { Injectable } from '@nestjs/common';
import { AppEvents, Clock, IdGenerator } from '../../../shared/domain';
import { itemChanged } from './list-events';
import { isDayPassed } from '../../../shared/domain/event-date';
import { ProductCatalog } from '../../catalog';
import {
  addRight,
  itemAccess,
  itemCriteria,
  type ItemRecipientView,
  type ItemView,
  projectItem,
  VisibilityService,
} from '../../visibility';
import { itemFactsOf } from '../domain/list';
import {
  CarryNotAllowedError,
  ListActionForbiddenError,
  ListInvalidError,
} from '../domain/list.errors';
import { EventLookup, ItemRepository, ListRepository } from '../domain/list.ports';
import { ListGate } from './list-gate';
import { eventForParticipant } from './manage-event-lists.use-case';

export interface CarryCandidateView {
  readonly event: { readonly id: string; readonly title: string; readonly date: string };
  readonly item: ItemRecipientView;
}

/** EVT-22 : souhaits non obtenus, en vue destinataire, calculés sans lire l'état réel. */
@Injectable()
export class ListCarryCandidates {
  constructor(
    private readonly items: ItemRepository,
    private readonly lists: ListRepository,
    private readonly lookup: EventLookup,
    private readonly gate: ListGate,
    private readonly clock: Clock,
  ) {}

  async execute(input: { viewerId: string; eventId: string }): Promise<CarryCandidateView[]> {
    await eventForParticipant(this.lookup, input.eventId, input.viewerId);
    const now = this.clock.now();
    const candidates = await this.items.carryCandidates(input.viewerId, input.eventId);
    const out: (CarryCandidateView & { order: number })[] = [];
    let order = 0;
    for (const candidate of candidates) {
      const { event } = candidate;
      // EVT-22 : listes d'un événement passé ou clos seulement.
      if (!event.closed && !isDayPassed(event.date, event.timezone, now)) continue;
      const list = await this.lists.find(candidate.listId);
      if (!list) continue;
      const { access } = await this.gate.accessOf(input.viewerId, list);
      if (access.kind !== 'recipient') continue;
      const decision = itemAccess(access, itemFactsOf(candidate.item), input.viewerId);
      const view = projectItem(decision, candidate.item, input.viewerId);
      if (view?.view !== 'recipient') continue;
      out.push({
        event: { id: event.id, title: event.title, date: event.date },
        item: view,
        order: order++,
      });
    }
    // Date d'événement décroissante, puis l'ordre de la liste (jamais la position brute, VIS-35).
    return out
      .sort((a, b) => b.event.date.localeCompare(a.event.date) || a.order - b.order)
      .map(({ order: _order, ...rest }) => rest);
  }
}

/** EVT-21, EVT-27 : reprendre des souhaits non obtenus dans une wishlist de l'événement. */
@Injectable()
export class CarryOver {
  constructor(
    private readonly items: ItemRepository,
    private readonly candidates: ListCarryCandidates,
    private readonly catalog: ProductCatalog,
    private readonly gate: ListGate,
    private readonly ids: IdGenerator,
    private readonly events: AppEvents,
  ) {}

  async execute(input: {
    viewerId: string;
    eventId: string;
    listId: string;
    itemIds: readonly string[];
  }): Promise<ItemView[]> {
    if (input.itemIds.length === 0 || new Set(input.itemIds).size !== input.itemIds.length) {
      throw new ListInvalidError();
    }
    const target = await this.gate.list(input.viewerId, input.listId);
    const { list, facts, access } = target;
    // EVT-27 : une wishlist de cet événement dont il est destinataire et contributeur.
    if (
      list.type !== 'WISHLIST' ||
      list.event?.id !== input.eventId ||
      access.kind !== 'recipient' ||
      addRight(facts, access) !== 'item'
    ) {
      throw new ListActionForbiddenError();
    }
    const open = new Map(
      (await this.candidates.execute({ viewerId: input.viewerId, eventId: input.eventId })).map(
        (c) => [c.item.id, c],
      ),
    );
    if (input.itemIds.some((id) => !open.has(id))) throw new CarryNotAllowedError();
    const out: ItemView[] = [];
    for (const itemId of input.itemIds) {
      const origin = await this.items.find(itemId);
      if (!origin) throw new CarryNotAllowedError();
      // REP-10 : une fiche publiée ne va pas sur une liste dont un autre est destinataire.
      const published = await this.catalog.findById(origin.product.id);
      const productId =
        published &&
        published.shareLevel !== 'PRIVATE' &&
        list.recipients.some((id) => id !== input.viewerId)
          ? (await this.catalog.copy(published.id, input.viewerId)).id
          : origin.product.id;
      const created = await this.items.carry({
        id: this.ids.next(),
        listId: list.id,
        productId,
        addedBy: input.viewerId,
        quantity: origin.quantity,
        unitPriceMinor: origin.unitPriceMinor,
        currency: origin.currency,
        priority: origin.priority,
        note: origin.note,
        manyWelcome: origin.manyWelcome,
        visibilityMode: origin.visibilityMode,
        isSuggestion: false,
        intendedRecipientId: null,
        shownToRecipient: false,
        carriedFromItemId: origin.id,
        ruleProfiles: origin.visibilityProfiles.map((profileId) => ({
          id: this.ids.next(),
          profileId,
        })),
      });
      if (created === 'already') throw new CarryNotAllowedError();
      this.events.publish(
        itemChanged({
          listId: list.id,
          itemId: created.id,
          change: 'created',
          actorId: input.viewerId,
        }),
      );
      const view = projectItem(
        itemAccess(access, itemFactsOf(created), input.viewerId),
        created,
        input.viewerId,
      );
      if (view) out.push(view);
    }
    return out;
  }
}

const IDEAS_LIMIT = 50;
const IDEAS_LISTS_LIMIT = 100;

/**
 * EVT-20, étape 2 ; EVT-23 : idées prises dans « Mes envies » et dans les listes des autres que le
 * profil voit en offreur. Chaque élément passe par le moteur ; la copie se fait ensuite par
 * `POST /items/{id}/copy` (ART-04), sans avis à l'autre.
 */
@Injectable()
export class SearchEventIdeas {
  constructor(
    private readonly lists: ListRepository,
    private readonly items: ItemRepository,
    private readonly lookup: EventLookup,
    private readonly gate: ListGate,
    private readonly visibility: VisibilityService,
  ) {}

  async execute(input: { viewerId: string; eventId: string; q: string }): Promise<ItemView[]> {
    await eventForParticipant(this.lookup, input.eventId, input.viewerId);
    const needle = input.q.trim().toLocaleLowerCase('fr');
    if (needle.length === 0) return [];
    const candidates = await this.lists.findCandidates(
      await this.visibility.listCandidates(input.viewerId),
    );
    const out: ItemView[] = [];
    for (const list of candidates.slice(0, IDEAS_LISTS_LIMIT)) {
      const { access } = await this.gate.accessOf(input.viewerId, list);
      const mine = list.personalProfileId === input.viewerId;
      if (!mine && access.kind !== 'giver') continue;
      const criteria = itemCriteria(access, input.viewerId);
      if (!criteria) continue;
      for (const row of await this.items.listItems(list.id, criteria, 'position')) {
        const text = `${row.product.title} ${row.product.description}`.toLocaleLowerCase('fr');
        if (!text.includes(needle)) continue;
        const view = projectItem(
          itemAccess(access, itemFactsOf(row), input.viewerId),
          row,
          input.viewerId,
        );
        if (view) out.push(view);
        if (out.length >= IDEAS_LIMIT) return out;
      }
    }
    return out;
  }
}
