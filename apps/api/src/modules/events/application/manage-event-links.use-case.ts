import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import {
  canCreateInviteLink,
  canManageInviteLinks,
  eventAccess,
  VisibilityService,
} from '../../visibility';
import {
  EVENT_LINK_USES_DEFAULT,
  EVENT_LINK_USES_MAX,
  type EventRecord,
  type EventType,
  type PersonCard,
} from '../domain/event';
import { endOfDay, isDayPassed } from '../../../shared/domain/event-date';
import {
  EventActionForbiddenError,
  EventChildOutsideCircleError,
  EventInvalidError,
  EventInvitationInvalidError,
  EventNotFoundError,
} from '../domain/event.errors';
import {
  type EventLinkRecord,
  EventLinkRepository,
  EventNotifier,
  EventPeople,
  EventRepository,
  EventTokens,
  ResponseFloor,
} from '../domain/event.ports';
import { EventGate } from './event-gate';

/** POST /events/{id}/links (EVT-16) : le jeton n'est rendu qu'une fois. */
@Injectable()
export class CreateEventLink {
  constructor(
    private readonly links: EventLinkRepository,
    private readonly gate: EventGate,
    private readonly people: EventPeople,
    private readonly tokens: EventTokens,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    viewerId: string;
    eventId: string;
    maxUses: number | null;
  }): Promise<{ link: EventLinkRecord; token: string }> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    const isChild = (await this.people.settings(input.viewerId))?.isChild ?? true;
    if (!canCreateInviteLink(gated.facts, gated.access, isChild)) {
      throw new EventActionForbiddenError();
    }
    const maxUses = input.maxUses ?? EVENT_LINK_USES_DEFAULT;
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > EVENT_LINK_USES_MAX) {
      throw new EventInvalidError();
    }
    const token = this.tokens.generate();
    const link = await this.links.create({
      id: this.ids.next(),
      eventId: input.eventId,
      createdBy: input.viewerId,
      tokenHash: this.tokens.hash(token),
      maxUses,
      expiresAt: endOfDay(gated.event.date, gated.event.timezone),
    });
    return { link, token };
  }
}

/** GET /events/{id}/links (EVT-16) */
@Injectable()
export class ListEventLinks {
  constructor(
    private readonly links: EventLinkRepository,
    private readonly gate: EventGate,
    private readonly clock: Clock,
  ) {}

  async execute(input: { viewerId: string; eventId: string }): Promise<EventLinkRecord[]> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    if (!canManageInviteLinks(gated.access)) throw new EventActionForbiddenError();
    return this.links.listOpen(input.eventId, this.clock.now());
  }
}

/** DELETE /events/{id}/links/{linkId} (EVT-16) */
@Injectable()
export class RevokeEventLink {
  constructor(
    private readonly links: EventLinkRepository,
    private readonly gate: EventGate,
    private readonly clock: Clock,
  ) {}

  async execute(input: { viewerId: string; eventId: string; linkId: string }): Promise<void> {
    const gated = await this.gate.event(input.viewerId, input.eventId);
    if (!canManageInviteLinks(gated.access)) throw new EventActionForbiddenError();
    if (!(await this.links.revoke(input.eventId, input.linkId, this.clock.now()))) {
      throw new EventNotFoundError();
    }
  }
}

export interface EventLinkPreview {
  readonly eventId: string;
  readonly title: string;
  readonly date: string;
  readonly type: EventType;
  readonly inviter: PersonCard | null;
  readonly alreadyParticipant: boolean;
}

interface OpenedLink {
  readonly link: EventLinkRecord;
  readonly event: EventRecord;
}

/**
 * EVT-16 : contrôles communs à l'aperçu et à l'inscription. Tout refus qui pourrait dire quelque
 * chose de l'événement (honoré de la surprise, blocage, lien fermé, événement passé ou annulé)
 * prend **la même forme** qu'un jeton inconnu.
 */
@Injectable()
export class EventLinkOpener {
  constructor(
    private readonly links: EventLinkRepository,
    private readonly events: EventRepository,
    private readonly people: EventPeople,
    private readonly visibility: VisibilityService,
    private readonly tokens: EventTokens,
    private readonly floor: ResponseFloor,
    private readonly clock: Clock,
  ) {}

  /** Tout refus attend le temps plancher (EVT-16, GFT-07). */
  async open(viewerId: string, token: string): Promise<OpenedLink> {
    const startedAt = this.clock.now();
    try {
      return await this.check(viewerId, token);
    } catch (error) {
      await this.floor.pad(startedAt);
      throw error;
    }
  }

  private async check(viewerId: string, token: string): Promise<OpenedLink> {
    if (!this.tokens.isWellFormed(token)) throw new EventInvitationInvalidError();
    const now = this.clock.now();
    const link = await this.links.findLive(this.tokens.hash(token), now);
    if (!link) throw new EventInvitationInvalidError();
    const event = await this.events.find(link.eventId);
    if (!event || event.status !== 'UPCOMING' || isDayPassed(event.date, event.timezone, now)) {
      throw new EventInvitationInvalidError();
    }
    const already = event.participants.some((p) => p.profileId === viewerId);
    if (link.usedCount >= link.maxUses && !already) throw new EventInvitationInvalidError();
    if (event.isSurprise && (await this.events.surpriseRecipients(event.id)).includes(viewerId)) {
      throw new EventInvitationInvalidError();
    }
    const organizers = event.participants
      .filter((p) => p.role === 'ORGANIZER')
      .map((p) => p.profileId);
    if (await this.people.blockedWithAny(viewerId, [link.createdBy, ...organizers])) {
      throw new EventInvitationInvalidError();
    }
    const settings = await this.people.settings(viewerId);
    if (!settings) throw new EventInvitationInvalidError();
    if (settings.isChild && !(await this.visibility.circleOf(viewerId)).includes(link.createdBy)) {
      throw new EventChildOutsideCircleError();
    }
    return { link, event };
  }
}

/** POST /events/links/inspect (EVT-16) */
@Injectable()
export class InspectEventLink {
  constructor(
    private readonly opener: EventLinkOpener,
    private readonly events: EventRepository,
  ) {}

  async execute(input: { viewerId: string; token: string }): Promise<EventLinkPreview> {
    const { link, event } = await this.opener.open(input.viewerId, input.token);
    const [inviter] = await this.events.cards([link.createdBy]);
    return {
      eventId: event.id,
      title: event.title,
      date: event.date,
      type: event.type,
      inviter: inviter ?? null,
      alreadyParticipant: event.participants.some((p) => p.profileId === input.viewerId),
    };
  }
}

/** POST /events/links/redeem (EVT-11, EVT-12, EVT-16) : le profil actif rejoint, `En attente`. */
@Injectable()
export class RedeemEventLink {
  constructor(
    private readonly opener: EventLinkOpener,
    private readonly links: EventLinkRepository,
    private readonly gate: EventGate,
    private readonly events: EventRepository,
    private readonly floor: ResponseFloor,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly notifier: EventNotifier,
  ) {}

  async execute(input: { viewerId: string; token: string }): Promise<{ eventId: string }> {
    const startedAt = this.clock.now();
    const { link, event } = await this.opener.open(input.viewerId, input.token);
    const outcome = await this.links.redeem({
      linkId: link.id,
      eventId: event.id,
      profileId: input.viewerId,
      participantId: this.ids.next(),
      now: this.clock.now(),
    });
    // Seconde barrière : l'inscription doit donner accès, sinon rien n'a eu lieu pour le client.
    const after = outcome === 'invalid' ? null : await this.events.find(event.id);
    if (!after || eventAccess(this.gate.facts(after), input.viewerId).kind === 'none') {
      await this.floor.pad(startedAt);
      throw new EventInvitationInvalidError();
    }
    if (outcome === 'joined') this.notifier.changed(event.id, true);
    return { eventId: event.id };
  }
}
