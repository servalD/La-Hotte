// Accès aux événements et permissions d'action (05, VIS-36, ADR 0017). Fonctions pures, comme pour
// les listes : le module `events` lit et écrit, il ne décide d'aucun accès (invariant 2).

export type EventMode = 'EXCHANGE' | 'HONOREE';
export type EventStatus = 'UPCOMING' | 'DONE' | 'CANCELLED';
export type EventRole = 'ORGANIZER' | 'PARTICIPANT';
export type Rsvp = 'PENDING' | 'YES' | 'MAYBE' | 'NO';

export interface EventParticipantFact {
  readonly profileId: string;
  readonly role: EventRole;
  /** EVT-07 : honoré participant, « à l'honneur » hors surprise seulement. */
  readonly isHonoree: boolean;
  readonly rsvp: Rsvp;
}

/**
 * Faits d'un événement. Les honorés d'une surprise n'y figurent pas : ils n'ont pas de ligne de
 * participant (EVT-07), et ne sont lus qu'après un accès accordé (ADR 0017).
 */
export interface EventFacts {
  readonly id: string;
  readonly mode: EventMode;
  readonly isSurprise: boolean;
  readonly status: EventStatus;
  /** Absent si le profil créateur a été supprimé. */
  readonly createdBy: string | null;
  readonly participants: readonly EventParticipantFact[];
  /** EVT-05 : la fin du jour de l'événement, dans son fuseau, est passée. */
  readonly datePassed: boolean;
}

export type EventAccess =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'participant';
      readonly role: EventRole;
      readonly rsvp: Rsvp;
      readonly isHonoree: boolean;
      readonly isCreator: boolean;
    };

const NONE: EventAccess = { kind: 'none' };

function participantOf(event: EventFacts, profileId: string): EventParticipantFact | undefined {
  return event.participants.find((participant) => participant.profileId === profileId);
}

/** EVT-08, VIS-36 : une ligne de participant, quelle que soit la réponse ; sinon rien. */
export function eventAccess(event: EventFacts, viewerId: string): EventAccess {
  const me = participantOf(event, viewerId);
  if (!me) return NONE;
  return {
    kind: 'participant',
    role: me.role,
    rsvp: me.rsvp,
    isHonoree: me.isHonoree,
    isCreator: event.createdBy === viewerId,
  };
}

/** EVT-14 : audience des listes rattachées. */
export function eventListAudience(event: EventFacts): string[] {
  return event.participants
    .filter((participant) => participant.rsvp === 'YES' || participant.rsvp === 'MAYBE')
    .map((participant) => participant.profileId);
}

/** EVT-38 */
export function isEventClosed(event: EventFacts): boolean {
  return event.status !== 'UPCOMING';
}

function isOrganizer(access: EventAccess): boolean {
  return access.kind === 'participant' && access.role === 'ORGANIZER';
}

/** À venir, date non passée (EVT-05, EVT-18, EVT-39). */
function open(event: EventFacts): boolean {
  return event.status === 'UPCOMING' && !event.datePassed;
}

/** EVT-03, EVT-39 */
export function canEditEvent(event: EventFacts, access: EventAccess): boolean {
  return isOrganizer(access) && open(event);
}

/** EVT-03, EVT-39 : le créateur seul. */
export function canDeleteEvent(event: EventFacts, viewerId: string): boolean {
  return event.createdBy !== null && event.createdBy === viewerId;
}

/** EVT-34 */
export function canCancelEvent(event: EventFacts, access: EventAccess): boolean {
  return isOrganizer(access) && event.status === 'UPCOMING';
}

/** EVT-15 */
export function canInvite(event: EventFacts, access: EventAccess): boolean {
  return isOrganizer(access) && open(event);
}

/** EVT-16 : un profil enfant ne crée pas de lien. */
export function canCreateInviteLink(
  event: EventFacts,
  access: EventAccess,
  viewerIsChild: boolean,
): boolean {
  return canInvite(event, access) && !viewerIsChild;
}

/** EVT-07 */
export function canAddHonoree(event: EventFacts, access: EventAccess): boolean {
  return isOrganizer(access) && open(event) && event.mode === 'HONOREE';
}

/** EVT-13, EVT-18 */
export function canRespond(event: EventFacts, access: EventAccess): boolean {
  return access.kind === 'participant' && open(event);
}

/** EVT-40 */
export function canRecreateEvent(event: EventFacts, access: EventAccess): boolean {
  return isOrganizer(access) && (event.status !== 'UPCOMING' || event.datePassed);
}

/** EVT-17 : jamais le créateur. */
export function canRemoveParticipant(
  event: EventFacts,
  access: EventAccess,
  targetId: string,
): boolean {
  if (!isOrganizer(access) || event.status !== 'UPCOMING') return false;
  if (targetId === event.createdBy) return false;
  return participantOf(event, targetId) !== undefined;
}

/** EVT-06 : un participant, jamais un honoré, devient organisateur. */
export function canNameOrganizer(event: EventFacts, access: EventAccess, targetId: string): boolean {
  if (!isOrganizer(access) || event.status !== 'UPCOMING') return false;
  const target = participantOf(event, targetId);
  return target !== undefined && target.role === 'PARTICIPANT' && !target.isHonoree;
}

/** EVT-06 : seul le créateur retire le rôle, jamais à lui-même. */
export function canRevokeOrganizer(event: EventFacts, viewerId: string, targetId: string): boolean {
  if (event.status !== 'UPCOMING' || !canDeleteEvent(event, viewerId)) return false;
  if (targetId === viewerId) return false;
  return participantOf(event, targetId)?.role === 'ORGANIZER';
}

/** EVT-29 : profils qui peuvent être destinataires d'une wishlist rattachée. */
export function wishlistRecipientsAllowed(event: EventFacts): string[] {
  return event.participants
    .filter((participant) => event.mode === 'EXCHANGE' || participant.isHonoree)
    .map((participant) => participant.profileId);
}

/** EVT-29 : la réponse permet-elle de rattacher une liste ? */
export function respondedPresent(event: EventFacts, profileId: string): boolean {
  const me = participantOf(event, profileId);
  return me !== undefined && (me.rsvp === 'YES' || me.rsvp === 'MAYBE');
}
