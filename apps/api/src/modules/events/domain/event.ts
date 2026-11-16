import type { EventFacts, EventMode, EventRole, EventStatus, Rsvp } from '../../visibility';

// Événements (05). Les décisions d'accès et d'action appartiennent à `visibility` (VIS-36) ; ce
// module tient les données et leurs invariants.

export const EVENT_TITLE_MAX = 120;
export const EVENT_PLACE_MAX = 200;
export const EVENT_DESCRIPTION_MAX = 2000;
export const EVENT_HONOREES_MAX = 10;
export const EVENT_INVITES_MAX = 50;
/** EVT-16 */
export const EVENT_LINK_USES_DEFAULT = 20;
export const EVENT_LINK_USES_MAX = 100;
/** Garde-fou de saisie, en unités mineures (même plafond que les prix d'un élément). */
export const EVENT_BUDGET_MAX = 1_000_000_000_00;

export type EventType = 'CHRISTMAS' | 'BIRTHDAY' | 'BIRTH' | 'WEDDING' | 'OTHER';

export interface EventParticipantRecord {
  readonly profileId: string;
  readonly role: EventRole;
  readonly isHonoree: boolean;
  readonly rsvp: Rsvp;
  readonly respondedAt: Date | null;
}

export interface EventRecord {
  readonly id: string;
  readonly title: string;
  /** `AAAA-MM-JJ` (EVT-05). */
  readonly date: string;
  readonly timezone: string;
  readonly place: string;
  readonly description: string;
  readonly type: EventType;
  readonly mode: EventMode;
  readonly isSurprise: boolean;
  readonly suggestedBudgetMinor: number | null;
  readonly currency: string;
  readonly status: EventStatus;
  readonly createdBy: string | null;
  readonly recreatedFromId: string | null;
  readonly participants: readonly EventParticipantRecord[];
  readonly createdAt: Date;
  readonly version: number;
}

/** Profil tel qu'un participant le voit dans l'événement (EVT-08). */
export interface PersonCard {
  readonly id: string;
  readonly displayName: string;
  readonly avatar: string | null;
  readonly accentColor: string;
}

/** Faits du moteur (VIS-36) ; `datePassed` est calculé avec l'heure du port `Clock`. */
export function eventFactsOf(event: EventRecord, datePassed: boolean): EventFacts {
  return {
    id: event.id,
    mode: event.mode,
    isSurprise: event.isSurprise,
    status: event.status,
    createdBy: event.createdBy,
    participants: event.participants.map((participant) => ({
      profileId: participant.profileId,
      role: participant.role,
      isHonoree: participant.isHonoree,
      rsvp: participant.rsvp,
    })),
    datePassed,
  };
}

/** Valeurs par défaut de `05` : échange pour Noël, à l'honneur pour les autres. */
export function defaultMode(type: EventType): EventMode {
  return type === 'CHRISTMAS' || type === 'OTHER' ? 'EXCHANGE' : 'HONOREE';
}

export interface EventTexts {
  readonly title?: string;
  readonly place?: string;
  readonly description?: string;
}

export function textProblem(texts: EventTexts): boolean {
  if (
    texts.title !== undefined &&
    (texts.title.trim().length === 0 || texts.title.length > EVENT_TITLE_MAX)
  ) {
    return true;
  }
  if (texts.place !== undefined && texts.place.length > EVENT_PLACE_MAX) return true;
  return texts.description !== undefined && texts.description.length > EVENT_DESCRIPTION_MAX;
}

export function budgetProblem(budget: number | null | undefined): boolean {
  if (budget === undefined || budget === null) return false;
  return !Number.isSafeInteger(budget) || budget <= 0 || budget > EVENT_BUDGET_MAX;
}

/** Champs modifiables (EVT-39). */
export interface EventChanges {
  readonly title?: string;
  readonly date?: string;
  readonly place?: string;
  readonly description?: string;
  readonly type?: EventType;
  readonly suggestedBudgetMinor?: number | null;
}
