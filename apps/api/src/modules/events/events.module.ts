import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { ListsModule } from '../lists';
import { VisibilityModule } from '../visibility';
import { EventAccessReader } from './application/event-access-reader';
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
  EventWishlistCreator,
  ResponseFloor,
} from './domain/event.ports';
import {
  CryptoEventTokens,
  IdentityEventInvitationMail,
  ListsEventWishlistCreator,
  AppEventsEventNotifier,
  SleepingResponseFloor,
} from './infrastructure/adapters';
import {
  PrismaEventLinkRepository,
  PrismaEventPeople,
  PrismaEventRepository,
} from './infrastructure/prisma-event-repository';
import { SendEventReminders } from './application/send-event-reminders.use-case';
import { EventCompletionScheduler } from './presentation/event-completion.scheduler';
import { EventReminderScheduler } from './presentation/event-reminder.scheduler';
import { EventsController } from './presentation/events.controller';

/** Module `events` : événements, participants, liens d'invitation (05). Accès par `visibility`. */
@Module({
  imports: [VisibilityModule, IdentityModule, ListsModule],
  controllers: [EventsController],
  providers: [
    EventGate,
    EventAccessReader,
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
    SendEventReminders,
    EventReminderScheduler,
    { provide: EventRepository, useClass: PrismaEventRepository },
    { provide: EventLinkRepository, useClass: PrismaEventLinkRepository },
    { provide: EventPeople, useClass: PrismaEventPeople },
    { provide: EventTokens, useClass: CryptoEventTokens },
    { provide: ResponseFloor, useClass: SleepingResponseFloor },
    { provide: EventInvitationMail, useClass: IdentityEventInvitationMail },
    { provide: EventNotifier, useClass: AppEventsEventNotifier },
    { provide: EventWishlistCreator, useClass: ListsEventWishlistCreator },
  ],
  exports: [EventAccessReader],
})
export class EventsModule {}
