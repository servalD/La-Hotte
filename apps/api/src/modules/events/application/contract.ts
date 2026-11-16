// Ce que la présentation peut connaître du module (QA-03).
export {
  EVENT_BUDGET_MAX,
  EVENT_DESCRIPTION_MAX,
  EVENT_HONOREES_MAX,
  EVENT_INVITES_MAX,
  EVENT_LINK_USES_MAX,
  EVENT_PLACE_MAX,
  EVENT_TITLE_MAX,
  type PersonCard,
} from '../domain/event';
export type { EventLinkRecord } from '../domain/event.ports';
export {
  CancelEvent,
  CompleteEvents,
  CreateEvent,
  DeleteEvent,
  type EventDetail,
  type EventParticipantDetail,
  type EventSummary,
  GetEvent,
  ListEvents,
  RecreateEvent,
  UpdateEvent,
} from './manage-events.use-case';
export {
  AddHonorees,
  InviteParticipants,
  NameOrganizer,
  RemoveParticipant,
  RespondToEvent,
  RevokeOrganizer,
} from './manage-participants.use-case';
export {
  CreateEventLink,
  type EventLinkPreview,
  InspectEventLink,
  ListEventLinks,
  RedeemEventLink,
  RevokeEventLink,
} from './manage-event-links.use-case';
