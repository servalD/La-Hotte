import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import {
  canAddHonoree,
  canInvite,
  canNameOrganizer,
  canRemoveParticipant,
  canRespond,
  canRevokeOrganizer,
  type Rsvp,
  VisibilityService,
} from '../../visibility';
import { EVENT_INVITES_MAX } from '../domain/event';
import {
  EventActionForbiddenError,
  EventHonoreeCannotParticipateError,
  EventInvalidError,
  EventProfileNotAllowedError,
} from '../domain/event.errors';
import {
  EventInvitationMail,
  EventNotifier,
  EventPeople,
  EventRepository,
  EventWishlistCreator,
} from '../domain/event.ports';
import { EventGate } from './event-gate';
import { checkHonorees, detailOfGated, type EventDetail } from './manage-events.use-case';

/** POST /events/{id}/participants (EVT-15) : profils du cercle de l'organisateur. */
@Injectable()
export class InviteParticipants {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly people: EventPeople,
    private readonly visibility: VisibilityService,
    private readonly mail: EventInvitationMail,
    private readonly ids: IdGenerator,
    private readonly notifier: EventNotifier,
  ) {}

  async execute(input: {
    viewerId: string;
    eventId: string;
    profileIds: readonly string[];
  }): Promise<EventDetail> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    if (!canInvite(gated.facts, gated.access)) throw new EventActionForbiddenError();
    const ids = input.profileIds;
    if (ids.length === 0 || new Set(ids).size !== ids.length || ids.length > EVENT_INVITES_MAX) {
      throw new EventInvalidError();
    }
    const circle = new Set(await this.visibility.circleOf(input.viewerId));
    if (ids.some((id) => !circle.has(id))) throw new EventProfileNotAllowedError();
    const result = await this.events.addParticipants({
      eventId: input.eventId,
      invitedBy: input.viewerId,
      rows: ids.map((profileId) => ({ id: this.ids.next(), profileId })),
    });
    if (result === 'surprise_honoree') throw new EventHonoreeCannotParticipateError();
    this.mail.notifyInvited(input.eventId, result.added, input.viewerId);
    this.notifier.changed(input.eventId, true);
    const after = await this.gate.event(input.viewerId, input.eventId);
    return detailOfGated(this.events, this.people, this.visibility, input.viewerId, after);
  }
}

/** DELETE /events/{id}/participants/{profileId} (EVT-17) : ses liens sont révoqués. */
@Injectable()
export class RemoveParticipant {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly clock: Clock,
    private readonly notifier: EventNotifier,
  ) {}

  async execute(input: { viewerId: string; eventId: string; profileId: string }): Promise<void> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    if (!canRemoveParticipant(gated.facts, gated.access, input.profileId)) {
      throw new EventActionForbiddenError();
    }
    // R3 : retrait et révocation de ses liens dans une même transaction.
    await this.events.removeParticipant(input.eventId, input.profileId, this.clock.now());
    this.notifier.changed(input.eventId, true);
  }
}

/** PUT /events/{id}/organizers/{profileId} (EVT-06) */
@Injectable()
export class NameOrganizer {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly clock: Clock,
  ) {}

  async execute(input: { viewerId: string; eventId: string; profileId: string }): Promise<void> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    if (!canNameOrganizer(gated.facts, gated.access, input.profileId)) {
      throw new EventActionForbiddenError();
    }
    await this.events.setRole(input.eventId, input.profileId, 'ORGANIZER', this.clock.now());
  }
}

/** DELETE /events/{id}/organizers/{profileId} (EVT-06) : ses liens sont révoqués (EVT-17). */
@Injectable()
export class RevokeOrganizer {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly clock: Clock,
  ) {}

  async execute(input: { viewerId: string; eventId: string; profileId: string }): Promise<void> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    if (!canRevokeOrganizer(gated.facts, input.viewerId, input.profileId)) {
      throw new EventActionForbiddenError();
    }
    // R3 : le rôle et la révocation de ses liens dans une même transaction.
    await this.events.setRole(input.eventId, input.profileId, 'PARTICIPANT', this.clock.now());
  }
}

/** POST /events/{id}/honorees (EVT-07) */
@Injectable()
export class AddHonorees {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly people: EventPeople,
    private readonly visibility: VisibilityService,
    private readonly mail: EventInvitationMail,
    private readonly ids: IdGenerator,
    private readonly notifier: EventNotifier,
  ) {}

  async execute(input: {
    viewerId: string;
    eventId: string;
    profileIds: readonly string[];
  }): Promise<EventDetail> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    if (!canAddHonoree(gated.facts, gated.access)) throw new EventActionForbiddenError();
    const { event } = gated;
    if (input.profileIds.length === 0) throw new EventInvalidError();
    await checkHonorees(this.visibility, input.viewerId, input.profileIds, event.isSurprise);
    const byId = new Map(event.participants.map((p) => [p.profileId, p]));
    for (const id of input.profileIds) {
      const existing = byId.get(id);
      if (!existing) continue;
      // EVT-07 : l'honoré d'une surprise n'est jamais participant ; EVT-06 : un organisateur
      // nommé n'est pas honoré (le créateur peut l'être, hors surprise).
      if (event.isSurprise) throw new EventProfileNotAllowedError();
      if (existing.role === 'ORGANIZER' && id !== event.createdBy) {
        throw new EventProfileNotAllowedError();
      }
    }
    const result = await this.events.addHonorees({
      eventId: event.id,
      surprise: event.isSurprise,
      invitedBy: input.viewerId,
      rows: input.profileIds.map((profileId) => ({ id: this.ids.next(), profileId })),
    });
    // EVT-07 (R1) : `list_member`, il verrait disparaître une liste rattachée dont il est membre.
    // Même refus que les autres : l'organisateur ne voit pas forcément cette liste.
    if (result !== 'ok') throw new EventProfileNotAllowedError();
    if (!event.isSurprise) {
      this.mail.notifyInvited(
        event.id,
        input.profileIds.filter((id) => !byId.has(id)),
        input.viewerId,
      );
    }
    // RT-10 : un honoré de surprise perd la vue des listes rattachées (VIS-36).
    this.notifier.changed(event.id, true);
    const after = await this.gate.event(input.viewerId, input.eventId);
    return detailOfGated(this.events, this.people, this.visibility, input.viewerId, after);
  }
}

export interface RsvpOutcome {
  readonly rsvp: Rsvp;
  /** EVT-36 : wishlist créée ou retrouvée à la réponse `Participe` (tranche 4). */
  readonly listId: string | null;
}

/** PUT /events/{id}/rsvp (EVT-13, EVT-14, EVT-18) */
@Injectable()
export class RespondToEvent {
  constructor(
    private readonly events: EventRepository,
    private readonly gate: EventGate,
    private readonly notifier: EventNotifier,
    private readonly wishlists: EventWishlistCreator,
    private readonly clock: Clock,
  ) {}

  async execute(input: { viewerId: string; eventId: string; rsvp: Rsvp }): Promise<RsvpOutcome> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    if (!canRespond(gated.facts, gated.access)) throw new EventActionForbiddenError();
    if (input.rsvp === 'PENDING') throw new EventInvalidError();
    const before = gated.access.rsvp;
    await this.events.setRsvp(input.eventId, input.viewerId, input.rsvp, this.clock.now());
    this.notifier.changed(input.eventId, true);
    // Critère de 05 : ses engagements alertent les organisateurs (port vide jusqu'aux phases 4 et 5).
    if (input.rsvp === 'NO' && (before === 'YES' || before === 'MAYBE')) {
      this.notifier.participantWithdrew(input.eventId, input.viewerId);
    }
    // EVT-36 : `Participe` à un échange, ou honoré hors surprise, ouvre sa wishlist rattachée.
    const bringsList = gated.event.mode === 'EXCHANGE' || gated.access.isHonoree;
    const listId =
      input.rsvp === 'YES' && bringsList
        ? await this.wishlists.ensure({ profileId: input.viewerId, eventId: input.eventId })
        : null;
    return { rsvp: input.rsvp, listId };
  }
}
