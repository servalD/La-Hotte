import { Injectable } from '@nestjs/common';
import { AppEvents, IdGenerator } from '../../../shared/domain';
import {
  canAttachList,
  canDetachList,
  isEventClosed,
  type ItemRecord,
  respondedPresent,
} from '../../visibility';
import { LIST_TITLE_MAX } from '../domain/list';
import { EventNotFoundForListError, ListActionForbiddenError } from '../domain/list.errors';
import { type EventForLists, EventLookup, ListRepository } from '../domain/list.ports';
import { listChanged } from './list-events';
import { ListGate } from './list-gate';
import { type ListSummary, summarize } from './manage-lists.use-case';

/**
 * EVT-29 : événement lu pour `viewerId`, qui doit en être participant ; sinon `404`, comme un
 * événement inconnu (EVT-08 : l'honoré d'une surprise n'y a pas de ligne).
 */
export async function eventForParticipant(
  lookup: EventLookup,
  eventId: string,
  viewerId: string,
): Promise<EventForLists> {
  const event = await lookup.find(eventId);
  if (!event?.participants.some((participant) => participant.profileId === viewerId)) {
    throw new EventNotFoundForListError();
  }
  return event;
}

/**
 * EVT-28 : événements d'origine des reprises que `viewerId` voit (il en est participant, EVT-08),
 * pour titrer la mention offreur. Les autres restent sans titre.
 */
export async function visibleOriginEvents(
  lookup: EventLookup,
  viewerId: string,
  items: readonly ItemRecord[],
): Promise<ReadonlySet<string>> {
  const ids = new Set(
    items.flatMap((item) => (item.carryOrigin?.event ? [item.carryOrigin.event.id] : [])),
  );
  const seen = new Set<string>();
  for (const id of ids) {
    const event = await lookup.find(id);
    if (event?.participants.some((p) => p.profileId === viewerId)) seen.add(id);
  }
  return seen;
}

/**
 * EVT-29, LST-07 : destinataires qu'une giftlist rattachée peut viser hors du cercle de son
 * créateur : les honorés (surprise comprise) « à l'honneur », les participants en échange.
 */
export async function eventRecipientPool(
  lookup: EventLookup,
  event: EventForLists,
): Promise<Set<string>> {
  if (event.mode === 'EXCHANGE') return new Set(event.participants.map((p) => p.profileId));
  const honorees = event.participants.filter((p) => p.isHonoree).map((p) => p.profileId);
  const secret = event.isSurprise ? await lookup.surpriseRecipients(event.id) : [];
  return new Set([...honorees, ...secret]);
}

/** PUT /lists/{id}/event (EVT-24, EVT-29) */
@Injectable()
export class AttachListToEvent {
  constructor(
    private readonly lists: ListRepository,
    private readonly lookup: EventLookup,
    private readonly gate: ListGate,
    private readonly events: AppEvents,
  ) {}

  async execute(input: {
    viewerId: string;
    listId: string;
    eventId: string;
  }): Promise<ListSummary> {
    const gated = await this.gate.list(input.viewerId, input.listId);
    const event = await eventForParticipant(this.lookup, input.eventId, input.viewerId);
    if (!canAttachList(gated.facts, event, input.viewerId)) throw new ListActionForbiddenError();
    if (!(await this.lists.attachEvent(input.listId, input.eventId))) {
      throw new ListActionForbiddenError();
    }
    this.events.publish(listChanged(input.listId, true));
    return summarize(await this.gate.list(input.viewerId, input.listId), input.viewerId);
  }
}

/** DELETE /lists/{id}/event (EVT-29) : une audience `EVENT` devient `MEMBERS`. */
@Injectable()
export class DetachListFromEvent {
  constructor(
    private readonly lists: ListRepository,
    private readonly gate: ListGate,
    private readonly events: AppEvents,
  ) {}

  async execute(input: { viewerId: string; listId: string }): Promise<ListSummary> {
    const gated = await this.gate.list(input.viewerId, input.listId);
    if (!canDetachList(gated.facts, input.viewerId)) throw new ListActionForbiddenError();
    await this.lists.detachEvent(input.listId);
    this.events.publish(listChanged(input.listId, true));
    return summarize(await this.gate.list(input.viewerId, input.listId), input.viewerId);
  }
}

/**
 * EVT-36 : wishlist rattachée créée à la première réponse `Participe`, ou retrouvée. Exposée au
 * module `events` par `lists/index.ts`, qui a vérifié la réponse et la forme de l'événement ; les
 * conditions de EVT-29 sont revérifiées ici.
 */
@Injectable()
export class EventWishlists {
  constructor(
    private readonly lists: ListRepository,
    private readonly lookup: EventLookup,
    private readonly ids: IdGenerator,
  ) {}

  async ensure(input: { profileId: string; eventId: string }): Promise<string | null> {
    const existing = await this.lists.findEventWishlist(input.eventId, input.profileId);
    if (existing) return existing;
    const event = await this.lookup.find(input.eventId);
    if (!event || isEventClosed(event) || !respondedPresent(event, input.profileId)) return null;
    const me = event.participants.find((p) => p.profileId === input.profileId);
    if (event.mode === 'HONOREE' && !me?.isHonoree) return null;
    const list = await this.lists.create({
      id: this.ids.next(),
      eventId: event.id,
      type: 'WISHLIST',
      title: event.title.slice(0, LIST_TITLE_MAX),
      description: '',
      creatorProfileId: input.profileId,
      creatorMemberId: this.ids.next(),
      personal: false,
      audience: 'EVENT',
      recipients: [{ id: this.ids.next(), profileId: input.profileId }],
      customAudience: [],
      giftExistence: 'HIDDEN',
      giftContent: 'NONE',
    });
    return list.id;
  }
}
