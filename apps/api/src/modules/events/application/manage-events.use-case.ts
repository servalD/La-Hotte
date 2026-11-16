import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import {
  canAddHonoree,
  canCancelEvent,
  canCreateInviteLink,
  canDeleteEvent,
  canEditEvent,
  canInvite,
  canManageInviteLinks,
  canRecreateEvent,
  canRespond,
  isEventClosed,
  type EventMode,
  type EventRole,
  type Rsvp,
  VisibilityService,
} from '../../visibility';
import {
  budgetProblem,
  defaultMode,
  EVENT_HONOREES_MAX,
  type EventChanges,
  type EventRecord,
  type EventType,
  type PersonCard,
  textProblem,
} from '../domain/event';
import {
  addDays,
  addOneYear,
  isDayTodayOrLater,
  isDoneDue,
  isValidDay,
  isValidTimezone,
  localDay,
} from '../../../shared/domain/event-date';
import {
  EventActionForbiddenError,
  EventDatePassedError,
  EventInvalidError,
  EventProfileNotAllowedError,
  EventVersionMismatchError,
} from '../domain/event.errors';
import {
  EventInvitationMail,
  EventNotifier,
  EventPeople,
  EventRepository,
  EventWishlistCreator,
  type NewEventParticipant,
} from '../domain/event.ports';
import { EventGate, type GatedEvent } from './event-gate';

/** Ce que le profil peut faire (rendu à l'interface ; le serveur revérifie à chaque action). */
export interface EventPermissions {
  readonly edit: boolean;
  readonly delete: boolean;
  readonly cancel: boolean;
  readonly invite: boolean;
  readonly createLink: boolean;
  readonly manageLinks: boolean;
  readonly addHonoree: boolean;
  readonly respond: boolean;
  readonly recreate: boolean;
}

export interface EventSummary extends GatedEvent {
  readonly permissions: EventPermissions;
}

export interface EventParticipantDetail extends PersonCard {
  readonly role: EventRole;
  readonly isHonoree: boolean;
  readonly rsvp: Rsvp;
}

export interface EventDetail extends EventSummary {
  readonly participants: readonly EventParticipantDetail[];
  /** EVT-08 : honorés d'une surprise, montrés à ses participants (tous offreurs) ; sinon `null`. */
  readonly surpriseHonorees: readonly PersonCard[] | null;
  /** GFT-08 : un participant partage le compte d'un honoré de la surprise (organisateurs seulement). */
  readonly sharedAccountWarning: boolean;
}

export async function permissionsOf(
  gated: GatedEvent,
  viewerId: string,
  people: EventPeople,
): Promise<EventPermissions> {
  const { facts, access } = gated;
  const invite = canInvite(facts, access);
  const isChild = invite ? ((await people.settings(viewerId))?.isChild ?? true) : true;
  return {
    edit: canEditEvent(facts, access),
    delete: canDeleteEvent(facts, viewerId),
    cancel: canCancelEvent(facts, access),
    invite,
    createLink: canCreateInviteLink(facts, access, isChild),
    manageLinks: canManageInviteLinks(access),
    addHonoree: canAddHonoree(facts, access),
    respond: canRespond(facts, access),
    recreate: canRecreateEvent(facts, access),
  };
}

/** EVT-07 : honorés pris dans le cercle de `actorId` ou, hors surprise, lui-même. */
export async function checkHonorees(
  visibility: VisibilityService,
  actorId: string,
  ids: readonly string[],
  surprise: boolean,
): Promise<void> {
  if (new Set(ids).size !== ids.length || ids.length > EVENT_HONOREES_MAX) {
    throw new EventInvalidError();
  }
  const circle = new Set(await visibility.circleOf(actorId));
  for (const id of ids) {
    if (id === actorId ? surprise : !circle.has(id)) throw new EventProfileNotAllowedError();
  }
}

/** GET /events (EVT-08) */
@Injectable()
export class ListEvents {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly people: EventPeople,
  ) {}

  async execute(input: { viewerId: string; scope: 'upcoming' | 'past' }): Promise<EventSummary[]> {
    const out: EventSummary[] = [];
    for (const event of await this.events.findForProfile(input.viewerId)) {
      const gated = this.gate.accessOf(input.viewerId, event);
      if (!gated) continue;
      const upcoming = gated.facts.status === 'UPCOMING' && !gated.facts.datePassed;
      if ((input.scope === 'upcoming') !== upcoming) continue;
      out.push({ ...gated, permissions: await permissionsOf(gated, input.viewerId, this.people) });
    }
    const order = input.scope === 'upcoming' ? 1 : -1;
    return out.sort((a, b) => order * a.event.date.localeCompare(b.event.date));
  }
}

export interface CreateEventInput {
  readonly viewerId: string;
  readonly title: string;
  readonly date: string;
  readonly place: string;
  readonly description: string;
  readonly type: EventType;
  readonly mode: EventMode | null;
  readonly isSurprise: boolean;
  readonly suggestedBudgetMinor: number | null;
  readonly honoreeIds: readonly string[];
}

/** POST /events (EVT-01 à EVT-09) */
@Injectable()
export class CreateEvent {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly people: EventPeople,
    private readonly visibility: VisibilityService,
    private readonly mail: EventInvitationMail,
    private readonly wishlists: EventWishlistCreator,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateEventInput): Promise<EventDetail> {
    const texts = { title: input.title, place: input.place, description: input.description };
    if (textProblem(texts) || budgetProblem(input.suggestedBudgetMinor)) {
      throw new EventInvalidError();
    }
    if (!isValidDay(input.date)) throw new EventInvalidError();
    const settings = await this.people.settings(input.viewerId);
    if (!settings || !isValidTimezone(settings.timezone)) throw new EventInvalidError();
    const now = this.clock.now();
    if (!isDayTodayOrLater(input.date, settings.timezone, now)) throw new EventDatePassedError();
    const mode = input.mode ?? defaultMode(input.type);
    // EVT-09 : une surprise est « à l'honneur » ; EVT-07 : honorés seulement « à l'honneur ».
    if (input.isSurprise && mode !== 'HONOREE') throw new EventInvalidError();
    if (mode === 'EXCHANGE' ? input.honoreeIds.length > 0 : input.honoreeIds.length === 0) {
      throw new EventInvalidError();
    }
    await checkHonorees(this.visibility, input.viewerId, input.honoreeIds, input.isSurprise);

    const creatorHonored = !input.isSurprise && input.honoreeIds.includes(input.viewerId);
    const participants: NewEventParticipant[] = [
      {
        id: this.ids.next(),
        profileId: input.viewerId,
        role: 'ORGANIZER',
        isHonoree: creatorHonored,
        rsvp: 'YES',
        invitedBy: null,
      },
    ];
    if (!input.isSurprise) {
      for (const id of input.honoreeIds) {
        if (id === input.viewerId) continue;
        participants.push({
          id: this.ids.next(),
          profileId: id,
          role: 'PARTICIPANT',
          isHonoree: true,
          rsvp: 'PENDING',
          invitedBy: input.viewerId,
        });
      }
    }
    const created = await this.events.create({
      id: this.ids.next(),
      title: input.title,
      date: input.date,
      timezone: settings.timezone,
      place: input.place,
      description: input.description,
      type: input.type,
      mode,
      isSurprise: input.isSurprise,
      suggestedBudgetMinor: input.suggestedBudgetMinor,
      currency: settings.currency,
      createdBy: input.viewerId,
      recreatedFromId: null,
      participants,
      surpriseRecipients: input.isSurprise
        ? input.honoreeIds.map((profileId) => ({ id: this.ids.next(), profileId }))
        : [],
      now,
    });
    if (created === 'conflict') throw new EventProfileNotAllowedError();
    this.mail.notifyInvited(
      participants.filter((p) => p.profileId !== input.viewerId).map((p) => p.profileId),
    );
    // EVT-36 : le créateur répond `Participe` d'office ; il apporte sa liste en échange, ou honoré.
    if (mode === 'EXCHANGE' || creatorHonored) {
      await this.wishlists.ensure({ profileId: input.viewerId, eventId: created.id });
    }
    return detailOf(this.gate, this.events, this.people, this.visibility, input.viewerId, created);
  }
}

/** Détail d'un événement vu par `viewerId` (EVT-08). */
export async function detailOf(
  gate: EventGate,
  events: EventRepository,
  people: EventPeople,
  visibility: VisibilityService,
  viewerId: string,
  event: EventRecord,
): Promise<EventDetail> {
  const gated = gate.accessOf(viewerId, event);
  if (!gated) throw new EventActionForbiddenError();
  return detailOfGated(events, people, visibility, viewerId, gated);
}

export async function detailOfGated(
  events: EventRepository,
  people: EventPeople,
  visibility: VisibilityService,
  viewerId: string,
  gated: GatedEvent,
): Promise<EventDetail> {
  const { event } = gated;
  // ADR 0017 : les honorés d'une surprise ne sont lus qu'après un accès accordé.
  const honoreeIds = event.isSurprise ? await events.surpriseRecipients(event.id) : [];
  const cards = new Map(
    (await events.cards([...event.participants.map((p) => p.profileId), ...honoreeIds])).map(
      (card) => [card.id, card],
    ),
  );
  const participants: EventParticipantDetail[] = [];
  for (const participant of event.participants) {
    const card = cards.get(participant.profileId);
    if (!card) continue;
    participants.push({
      ...card,
      role: participant.role,
      isHonoree: participant.isHonoree,
      rsvp: participant.rsvp,
    });
  }
  let sharedAccountWarning = false;
  if (event.isSurprise && gated.access.role === 'ORGANIZER') {
    outer: for (const honoree of honoreeIds) {
      for (const participant of event.participants) {
        if (await visibility.sameAccount(honoree, participant.profileId)) {
          sharedAccountWarning = true;
          break outer;
        }
      }
    }
  }
  return {
    ...gated,
    permissions: await permissionsOf(gated, viewerId, people),
    participants,
    surpriseHonorees: event.isSurprise
      ? honoreeIds.flatMap((id) => {
          const card = cards.get(id);
          return card ? [card] : [];
        })
      : null,
    sharedAccountWarning,
  };
}

/** GET /events/{id} */
@Injectable()
export class GetEvent {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly people: EventPeople,
    private readonly visibility: VisibilityService,
  ) {}

  async execute(input: { viewerId: string; eventId: string }): Promise<EventDetail> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    return detailOfGated(this.events, this.people, this.visibility, input.viewerId, gated);
  }
}

/** PATCH /events/{id} (EVT-39, API-17) */
@Injectable()
export class UpdateEvent {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly people: EventPeople,
    private readonly visibility: VisibilityService,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    viewerId: string;
    eventId: string;
    expectedVersion: number;
    changes: EventChanges;
  }): Promise<EventDetail> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    if (!canEditEvent(gated.facts, gated.access)) throw new EventActionForbiddenError();
    const { changes } = input;
    if (textProblem(changes) || budgetProblem(changes.suggestedBudgetMinor)) {
      throw new EventInvalidError();
    }
    if (changes.date !== undefined) {
      if (!isValidDay(changes.date)) throw new EventInvalidError();
      if (!isDayTodayOrLater(changes.date, gated.event.timezone, this.clock.now())) {
        throw new EventDatePassedError();
      }
    }
    const updated = await this.events.update({
      eventId: input.eventId,
      expectedVersion: input.expectedVersion,
      changes,
    });
    if (updated === 'version') throw new EventVersionMismatchError();
    if (updated === 'missing') throw new EventActionForbiddenError();
    return detailOf(this.gate, this.events, this.people, this.visibility, input.viewerId, updated);
  }
}

/** DELETE /events/{id} (EVT-39) */
@Injectable()
export class DeleteEvent {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly clock: Clock,
  ) {}

  async execute(input: { viewerId: string; eventId: string }): Promise<void> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    if (!canDeleteEvent(gated.facts, input.viewerId)) throw new EventActionForbiddenError();
    // EVT-39 (R2) : détachées, les listes d'un événement clos resteraient modifiables (EVT-38).
    await this.events.delete(input.eventId, this.clock.now(), isEventClosed(gated.facts));
  }
}

/** POST /events/{id}/cancel (EVT-34) */
@Injectable()
export class CancelEvent {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly people: EventPeople,
    private readonly visibility: VisibilityService,
    private readonly notifier: EventNotifier,
    private readonly clock: Clock,
  ) {}

  async execute(input: { viewerId: string; eventId: string }): Promise<EventDetail> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    if (!canCancelEvent(gated.facts, gated.access)) throw new EventActionForbiddenError();
    await this.events.cancel(input.eventId, this.clock.now());
    this.notifier.eventCancelled(input.eventId);
    const after = await this.gate.event(input.viewerId, input.eventId);
    return detailOfGated(this.events, this.people, this.visibility, input.viewerId, after);
  }
}

/** POST /events/{id}/recreate (EVT-35, EVT-40) */
@Injectable()
export class RecreateEvent {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly people: EventPeople,
    private readonly visibility: VisibilityService,
    private readonly mail: EventInvitationMail,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: { viewerId: string; eventId: string }): Promise<EventDetail> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    if (!canRecreateEvent(gated.facts, gated.access)) throw new EventActionForbiddenError();
    const { event } = gated;
    const now = this.clock.now();
    let date = addOneYear(event.date);
    while (!isDayTodayOrLater(date, event.timezone, now)) date = addOneYear(date);

    const participants: NewEventParticipant[] = event.participants.map((p) => {
      const me = p.profileId === input.viewerId;
      return {
        id: this.ids.next(),
        profileId: p.profileId,
        role: me ? 'ORGANIZER' : p.role,
        isHonoree: p.isHonoree,
        rsvp: me ? 'YES' : 'PENDING',
        invitedBy: me ? null : input.viewerId,
      };
    });
    const surprise = event.isSurprise ? await this.events.surpriseRecipients(event.id) : [];
    const created = await this.events.create({
      id: this.ids.next(),
      title: event.title,
      date,
      timezone: event.timezone,
      place: event.place,
      description: event.description,
      type: event.type,
      mode: event.mode,
      isSurprise: event.isSurprise,
      suggestedBudgetMinor: event.suggestedBudgetMinor,
      currency: event.currency,
      createdBy: input.viewerId,
      recreatedFromId: event.id,
      participants,
      surpriseRecipients: surprise.map((profileId) => ({ id: this.ids.next(), profileId })),
      now,
    });
    if (created === 'conflict') throw new EventProfileNotAllowedError();
    this.mail.notifyInvited(
      participants.filter((p) => p.profileId !== input.viewerId).map((p) => p.profileId),
    );
    return detailOf(this.gate, this.events, this.people, this.visibility, input.viewerId, created);
  }
}

/** EVT-33 : passage à `DONE` 30 jours après la date (tâche planifiée). */
@Injectable()
export class CompleteEvents {
  constructor(
    private readonly events: EventRepository,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    // Candidats larges (aucun fuseau n'a plus de 14 h d'avance), revérifiés dans leur fuseau.
    const candidates = await this.events.upcomingBefore(addDays(localDay(now, 'UTC'), -29));
    let count = 0;
    for (const event of candidates) {
      if (!isDoneDue(event.date, event.timezone, now)) continue;
      await this.events.markDone(event.id);
      count += 1;
    }
    return count;
  }
}
