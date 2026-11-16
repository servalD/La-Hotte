import { ApiProperty } from '@nestjs/swagger';
import { EVENT_MODES, EVENT_ROLES, EVENT_STATUSES, EVENT_TYPES, RSVPS } from './event.dto';

// Vues de réponse (EVT-08). Une ligne de participant suffit pour voir l'événement : la vue est la
// même pour tous les participants, sauf `permissions` et `sharedAccountWarning`.

export class EventPermissionsView {
  @ApiProperty() edit!: boolean;
  @ApiProperty() delete!: boolean;
  @ApiProperty() cancel!: boolean;
  @ApiProperty() invite!: boolean;
  @ApiProperty() createLink!: boolean;
  @ApiProperty() manageLinks!: boolean;
  @ApiProperty() addHonoree!: boolean;
  @ApiProperty() respond!: boolean;
  @ApiProperty() recreate!: boolean;
}

/** EVT-08 : un profil, dans le cadre de l'événement seulement. */
export class EventPersonView {
  @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) avatar!: string | null;
  @ApiProperty() accentColor!: string;
}

export class EventParticipantView extends EventPersonView {
  @ApiProperty({ enum: EVENT_ROLES, enumName: 'EventRole' }) role!: (typeof EVENT_ROLES)[number];
  @ApiProperty() isHonoree!: boolean;
  @ApiProperty({ enum: RSVPS, enumName: 'Rsvp' }) rsvp!: (typeof RSVPS)[number];
}

export class EventSummaryView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty() place!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: EVENT_TYPES, enumName: 'EventType' }) type!: (typeof EVENT_TYPES)[number];
  @ApiProperty({ enum: EVENT_MODES, enumName: 'EventMode' }) mode!: (typeof EVENT_MODES)[number];
  @ApiProperty() isSurprise!: boolean;
  @ApiProperty({ type: Number, nullable: true }) suggestedBudgetMinor!: number | null;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: EVENT_STATUSES, enumName: 'EventStatus' })
  status!: (typeof EVENT_STATUSES)[number];
  /** EVT-05 : la date est passée dans le fuseau de l'événement. */
  @ApiProperty() datePassed!: boolean;
  @ApiProperty({ enum: EVENT_ROLES, enumName: 'EventRole' }) myRole!: (typeof EVENT_ROLES)[number];
  @ApiProperty({ enum: RSVPS, enumName: 'Rsvp' }) myRsvp!: (typeof RSVPS)[number];
  @ApiProperty() iAmHonoree!: boolean;
  @ApiProperty() version!: number;
  @ApiProperty({ type: EventPermissionsView }) permissions!: EventPermissionsView;
}

export class EventCollectionView {
  @ApiProperty({ type: [EventSummaryView] }) items!: EventSummaryView[];
}

export class EventDetailView extends EventSummaryView {
  @ApiProperty({ type: [EventParticipantView] }) participants!: EventParticipantView[];
  /** EVT-08 : honorés d'une surprise ; `null` hors surprise (ils sont alors participants). */
  @ApiProperty({ type: [EventPersonView], nullable: true })
  surpriseHonorees!: EventPersonView[] | null;
  /** GFT-08 : un participant partage le compte d'un honoré de la surprise (organisateurs). */
  @ApiProperty() sharedAccountWarning!: boolean;
}

export class EventParticipantCollectionView {
  @ApiProperty({ type: [EventParticipantView] }) items!: EventParticipantView[];
}

export class RsvpView {
  @ApiProperty({ enum: RSVPS, enumName: 'Rsvp' }) rsvp!: (typeof RSVPS)[number];
  /** EVT-36 : wishlist rattachée, créée ou retrouvée à la réponse `Participe`. */
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) listId!: string | null;
}

export class EventLinkView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty() maxUses!: number;
  @ApiProperty() usedCount!: number;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class EventLinkCollectionView {
  @ApiProperty({ type: [EventLinkView] }) items!: EventLinkView[];
}

/** EVT-16 : le jeton n'est rendu qu'à la création. */
export class CreatedEventLinkView {
  @ApiProperty({ type: EventLinkView }) link!: EventLinkView;
  @ApiProperty() token!: string;
}

export class EventLinkPreviewView {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty({ enum: EVENT_TYPES, enumName: 'EventType' }) type!: (typeof EVENT_TYPES)[number];
  @ApiProperty({ type: EventPersonView, nullable: true }) inviter!: EventPersonView | null;
  @ApiProperty() alreadyParticipant!: boolean;
}

export class JoinedEventView {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
}
