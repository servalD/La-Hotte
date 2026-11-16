import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveProfile, type ActiveProfileValue, RequiresProfile } from '../../identity';
import { parseIfMatch } from '../../../platform/http/if-match';
import {
  AddHonorees,
  CancelEvent,
  CreateEvent,
  CreateEventLink,
  DeleteEvent,
  type EventDetail,
  type EventLinkRecord,
  type EventSummary,
  GetEvent,
  InspectEventLink,
  InviteParticipants,
  ListEventLinks,
  ListEvents,
  NameOrganizer,
  RecreateEvent,
  RedeemEventLink,
  RemoveParticipant,
  RespondToEvent,
  RevokeEventLink,
  RevokeOrganizer,
  UpdateEvent,
} from '../application/contract';
import {
  CreateEventDto,
  CreateEventLinkDto,
  EventLinkTokenDto,
  EventProfilesDto,
  EventsQueryDto,
  RsvpDto,
  UpdateEventDto,
} from './dto/event.dto';
import {
  CreatedEventLinkView,
  EventCollectionView,
  EventDetailView,
  EventLinkCollectionView,
  EventLinkPreviewView,
  type EventLinkView,
  EventParticipantCollectionView,
  type EventParticipantView,
  type EventSummaryView,
  JoinedEventView,
  RsvpView,
} from './dto/event.view';

const UUID_PARAM = { schema: { type: 'string', format: 'uuid' } } as const;

function toSummary(summary: EventSummary): EventSummaryView {
  const { event, facts, access, permissions } = summary;
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    timezone: event.timezone,
    place: event.place,
    description: event.description,
    type: event.type,
    mode: event.mode,
    isSurprise: event.isSurprise,
    suggestedBudgetMinor: event.suggestedBudgetMinor,
    currency: event.currency,
    status: event.status,
    datePassed: facts.datePassed,
    myRole: access.role,
    myRsvp: access.rsvp,
    iAmHonoree: access.isHonoree,
    version: event.version,
    permissions: {
      edit: permissions.edit,
      delete: permissions.delete,
      cancel: permissions.cancel,
      invite: permissions.invite,
      createLink: permissions.createLink,
      manageLinks: permissions.manageLinks,
      addHonoree: permissions.addHonoree,
      respond: permissions.respond,
      recreate: permissions.recreate,
    },
  };
}

function toDetail(detail: EventDetail): EventDetailView {
  return Object.assign(toSummary(detail), {
    participants: detail.participants.map((p): EventParticipantView => ({
      profileId: p.id,
      displayName: p.displayName,
      avatar: p.avatar,
      accentColor: p.accentColor,
      role: p.role,
      isHonoree: p.isHonoree,
      rsvp: p.rsvp,
    })),
    surpriseHonorees:
      detail.surpriseHonorees?.map((card) => ({
        profileId: card.id,
        displayName: card.displayName,
        avatar: card.avatar,
        accentColor: card.accentColor,
      })) ?? null,
    sharedAccountWarning: detail.sharedAccountWarning,
  });
}

function toLink(link: EventLinkRecord): EventLinkView {
  return {
    id: link.id,
    createdBy: link.createdBy,
    maxUses: link.maxUses,
    usedCount: link.usedCount,
    expiresAt: link.expiresAt.toISOString(),
    createdAt: link.createdAt.toISOString(),
  };
}

/**
 * Événements (05). Toute lecture passe par `visibility` (VIS-36) ; un événement où le profil n'a
 * pas de ligne répond `404` comme un identifiant inconnu (EVT-08). Le profil vient de la session.
 */
@ApiTags('events')
@RequiresProfile()
@Controller('events')
export class EventsController {
  constructor(
    private readonly listAll: ListEvents,
    private readonly createEvent: CreateEvent,
    private readonly getEvent: GetEvent,
    private readonly updateEvent: UpdateEvent,
    private readonly deleteEvent: DeleteEvent,
    private readonly cancelEvent: CancelEvent,
    private readonly recreateEvent: RecreateEvent,
    private readonly invite: InviteParticipants,
    private readonly removeParticipant: RemoveParticipant,
    private readonly nameOrganizer: NameOrganizer,
    private readonly revokeOrganizer: RevokeOrganizer,
    private readonly addHonorees: AddHonorees,
    private readonly respond: RespondToEvent,
    private readonly createLink: CreateEventLink,
    private readonly listLinks: ListEventLinks,
    private readonly revokeLink: RevokeEventLink,
    private readonly inspectLink: InspectEventLink,
    private readonly redeemLink: RedeemEventLink,
  ) {}

  @Get()
  @ApiOkResponse({ type: EventCollectionView })
  async listEvents(
    @Query() query: EventsQueryDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<EventCollectionView> {
    const events = await this.listAll.execute({
      viewerId: profile.id,
      scope: query.scope ?? 'upcoming',
    });
    return { items: events.map(toSummary) };
  }

  @Post()
  @ApiCreatedResponse({ type: EventDetailView })
  async createNewEvent(
    @Body() body: CreateEventDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<EventDetailView> {
    const detail = await this.createEvent.execute({
      viewerId: profile.id,
      title: body.title,
      date: body.date,
      place: body.place ?? '',
      description: body.description ?? '',
      type: body.type,
      mode: body.mode ?? null,
      isSurprise: body.isSurprise ?? false,
      suggestedBudgetMinor: body.suggestedBudgetMinor ?? null,
      honoreeIds: body.honoreeIds ?? [],
    });
    return toDetail(detail);
  }

  /** EVT-16 : aperçu d'un lien, jeton dans le corps. */
  @Post('links/inspect')
  @HttpCode(200)
  @ApiOkResponse({ type: EventLinkPreviewView })
  async inspectEventLink(
    @Body() body: EventLinkTokenDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<EventLinkPreviewView> {
    const preview = await this.inspectLink.execute({ viewerId: profile.id, token: body.token });
    return {
      eventId: preview.eventId,
      title: preview.title,
      date: preview.date,
      type: preview.type,
      inviter: preview.inviter
        ? {
            profileId: preview.inviter.id,
            displayName: preview.inviter.displayName,
            avatar: preview.inviter.avatar,
            accentColor: preview.inviter.accentColor,
          }
        : null,
      alreadyParticipant: preview.alreadyParticipant,
    };
  }

  /** EVT-16 : le profil actif rejoint l'événement. */
  @Post('links/redeem')
  @HttpCode(200)
  @ApiOkResponse({ type: JoinedEventView })
  async redeemEventLink(
    @Body() body: EventLinkTokenDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<JoinedEventView> {
    return this.redeemLink.execute({ viewerId: profile.id, token: body.token });
  }

  @Get(':id')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: EventDetailView })
  async getOneEvent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<EventDetailView> {
    return toDetail(await this.getEvent.execute({ viewerId: profile.id, eventId: id }));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader({ name: 'If-Match', required: true, description: 'Version lue (API-17).' })
  @ApiOkResponse({ type: EventDetailView })
  async updateOneEvent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateEventDto,
    @Headers('if-match') ifMatch: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<EventDetailView> {
    const detail = await this.updateEvent.execute({
      viewerId: profile.id,
      eventId: id,
      expectedVersion: parseIfMatch(ifMatch),
      changes: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.date !== undefined ? { date: body.date } : {}),
        ...(body.place !== undefined ? { place: body.place } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.suggestedBudgetMinor !== undefined
          ? { suggestedBudgetMinor: body.suggestedBudgetMinor }
          : {}),
      },
    });
    return toDetail(detail);
  }

  /** EVT-39 : par le créateur seul. */
  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async deleteOneEvent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.deleteEvent.execute({ viewerId: profile.id, eventId: id });
  }

  /** EVT-34 */
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: EventDetailView })
  async cancelOneEvent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<EventDetailView> {
    return toDetail(await this.cancelEvent.execute({ viewerId: profile.id, eventId: id }));
  }

  /** EVT-35, EVT-40 */
  @Post(':id/recreate')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiCreatedResponse({ type: EventDetailView })
  async recreateOneEvent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<EventDetailView> {
    return toDetail(await this.recreateEvent.execute({ viewerId: profile.id, eventId: id }));
  }

  @Get(':id/participants')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: EventParticipantCollectionView })
  async listEventParticipants(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<EventParticipantCollectionView> {
    const detail = toDetail(await this.getEvent.execute({ viewerId: profile.id, eventId: id }));
    return { items: detail.participants };
  }

  /** EVT-15 */
  @Post(':id/participants')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: EventDetailView })
  async inviteEventParticipants(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: EventProfilesDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<EventDetailView> {
    const detail = await this.invite.execute({
      viewerId: profile.id,
      eventId: id,
      profileIds: body.profileIds,
    });
    return toDetail(detail);
  }

  /** EVT-17 */
  @Delete(':id/participants/:profileId')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiParam({ name: 'profileId', ...UUID_PARAM })
  @ApiNoContentResponse()
  async removeEventParticipant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.removeParticipant.execute({ viewerId: profile.id, eventId: id, profileId });
  }

  /** EVT-06 */
  @Put(':id/organizers/:profileId')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiParam({ name: 'profileId', ...UUID_PARAM })
  @ApiNoContentResponse()
  async nameEventOrganizer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.nameOrganizer.execute({ viewerId: profile.id, eventId: id, profileId });
  }

  /** EVT-06 : par le créateur seul. */
  @Delete(':id/organizers/:profileId')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiParam({ name: 'profileId', ...UUID_PARAM })
  @ApiNoContentResponse()
  async revokeEventOrganizer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.revokeOrganizer.execute({ viewerId: profile.id, eventId: id, profileId });
  }

  /** EVT-07 */
  @Post(':id/honorees')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: EventDetailView })
  async addEventHonorees(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: EventProfilesDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<EventDetailView> {
    const detail = await this.addHonorees.execute({
      viewerId: profile.id,
      eventId: id,
      profileIds: body.profileIds,
    });
    return toDetail(detail);
  }

  /** EVT-13, EVT-36 */
  @Put(':id/rsvp')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: RsvpView })
  async respondToEvent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RsvpDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<RsvpView> {
    return this.respond.execute({ viewerId: profile.id, eventId: id, rsvp: body.rsvp });
  }

  /** EVT-16 */
  @Get(':id/links')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: EventLinkCollectionView })
  async listEventLinks(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<EventLinkCollectionView> {
    const links = await this.listLinks.execute({ viewerId: profile.id, eventId: id });
    return { items: links.map(toLink) };
  }

  /** EVT-16 : le jeton n'est rendu qu'ici. */
  @Post(':id/links')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiCreatedResponse({ type: CreatedEventLinkView })
  async createEventLink(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateEventLinkDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<CreatedEventLinkView> {
    const { link, token } = await this.createLink.execute({
      viewerId: profile.id,
      eventId: id,
      maxUses: body.maxUses ?? null,
    });
    return { link: toLink(link), token };
  }

  @Delete(':id/links/:linkId')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiParam({ name: 'linkId', ...UUID_PARAM })
  @ApiNoContentResponse()
  async revokeEventLink(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('linkId', new ParseUUIDPipe()) linkId: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.revokeLink.execute({ viewerId: profile.id, eventId: id, linkId });
  }
}
