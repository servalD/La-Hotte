import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { VisibilityModule } from '../visibility';
import { EventGate } from './application/event-gate';
import {
  CreateEventLink,
  EventLinkOpener,
  InspectEventLink,
  ListEventLinks,
  RedeemEventLink,
  RevokeEventLink,
} from './application/manage-event-links.use-case';
import {
  CancelEvent,
  CompleteEvents,
  CreateEvent,
  DeleteEvent,
  GetEvent,
  ListEvents,
  RecreateEvent,
  UpdateEvent,
} from './application/manage-events.use-case';
import {
  AddHonorees,
  InviteParticipants,
  NameOrganizer,
  RemoveParticipant,
  RespondToEvent,
  RevokeOrganizer,
} from './application/manage-participants.use-case';
import {
  EventInvitationMail,
  EventLinkRepository,
  EventNotifier,
  EventPeople,
  EventRepository,
  EventTokens,
  ResponseFloor,
} from './domain/event.ports';
import {
  CryptoEventTokens,
  IdentityEventInvitationMail,
  NoEventNotifier,
  SleepingResponseFloor,
} from './infrastructure/adapters';
import {
  PrismaEventLinkRepository,
  PrismaEventPeople,
  PrismaEventRepository,
} from './infrastructure/prisma-event-repository';
import { EventCompletionScheduler } from './presentation/event-completion.scheduler';
import { EventsController } from './presentation/events.controller';

/** Module `events` : événements, participants, liens d'invitation (05). Accès par `visibility`. */
@Module({
  imports: [VisibilityModule, IdentityModule],
  controllers: [EventsController],
  providers: [
    EventGate,
    ListEvents,
    CreateEvent,
    GetEvent,
    UpdateEvent,
    DeleteEvent,
    CancelEvent,
    RecreateEvent,
    CompleteEvents,
    InviteParticipants,
    RemoveParticipant,
    NameOrganizer,
    RevokeOrganizer,
    AddHonorees,
    RespondToEvent,
    CreateEventLink,
    ListEventLinks,
    RevokeEventLink,
    EventLinkOpener,
    InspectEventLink,
    RedeemEventLink,
    EventCompletionScheduler,
    { provide: EventRepository, useClass: PrismaEventRepository },
    { provide: EventLinkRepository, useClass: PrismaEventLinkRepository },
    { provide: EventPeople, useClass: PrismaEventPeople },
    { provide: EventTokens, useClass: CryptoEventTokens },
    { provide: ResponseFloor, useClass: SleepingResponseFloor },
    { provide: EventInvitationMail, useClass: IdentityEventInvitationMail },
    { provide: EventNotifier, useClass: NoEventNotifier },
  ],
})
export class EventsModule {}
