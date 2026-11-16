import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, IsUUID, Length } from 'class-validator';
import { ActiveProfile, type ActiveProfileValue, RequiresProfile } from '../../identity';
import {
  CarryOver,
  GetEventProgress,
  ListCarryCandidates,
  SearchEventIdeas,
} from '../application/contract';
import { ItemCollectionView, ItemRecipientView } from './dto/list.view';
import { toItemView } from './mappers';

const UUID_PARAM = { schema: { type: 'string', format: 'uuid' } } as const;
const CARRY_MAX = 50;

/** EVT-21, EVT-27 */
export class CarryOverDto {
  @IsUUID('all')
  @ApiProperty({ format: 'uuid' })
  listId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CARRY_MAX)
  @IsUUID('all', { each: true })
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: CARRY_MAX })
  itemIds!: string[];
}

export class IdeasQueryDto {
  @IsString()
  @Length(1, 100)
  @ApiProperty({ minLength: 1, maxLength: 100 })
  q!: string;
}

export class CarryEventView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date' }) date!: string;
}

/** EVT-22 : un souhait non obtenu, en vue destinataire, avec l'événement de sa liste. */
export class CarryCandidateView {
  @ApiProperty({ type: CarryEventView }) event!: CarryEventView;
  @ApiProperty({ type: ItemRecipientView }) item!: ItemRecipientView;
}

export class CarryCandidateCollectionView {
  @ApiProperty({ type: [CarryCandidateView] }) items!: CarryCandidateView[];
}

/** EVT-30, EVT-31, EVT-37 : calculé sur les listes vues en offreur seulement. */
export class EventProgressView {
  @ApiProperty() itemsTotal!: number;
  @ApiProperty() itemsWithGiver!: number;
  @ApiProperty({ type: [String], format: 'uuid' }) recipients!: string[];
  @ApiProperty({ type: [String], format: 'uuid' }) recipientsWithoutGiver!: string[];
}

/**
 * Reprise et pioche de l'assistant (EVT-20 à EVT-23). Portées par `lists`, qui tient les
 * éléments ; l'événement doit compter le profil parmi ses participants, sinon `404`.
 */
@ApiTags('events')
@RequiresProfile()
@Controller('events')
export class EventCarryController {
  constructor(
    private readonly candidates: ListCarryCandidates,
    private readonly carry: CarryOver,
    private readonly ideas: SearchEventIdeas,
    private readonly progress: GetEventProgress,
  ) {}

  /** EVT-30, EVT-31 : jamais sur une liste dont le lecteur est destinataire (EVT-37). */
  @Get(':id/progress')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: EventProgressView })
  async getEventProgress(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<EventProgressView> {
    const result = await this.progress.execute({ viewerId: profile.id, eventId: id });
    return {
      itemsTotal: result.itemsTotal,
      itemsWithGiver: result.itemsWithGiver,
      recipients: [...result.recipients],
      recipientsWithoutGiver: [...result.recipientsWithoutGiver],
    };
  }

  /** EVT-22 : identique que les souhaits passés soient ouverts, réservés ou achetés. */
  @Get(':id/carry-over')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: CarryCandidateCollectionView })
  async listCarryCandidates(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<CarryCandidateCollectionView> {
    const found = await this.candidates.execute({ viewerId: profile.id, eventId: id });
    return {
      items: found.map((c) => ({
        event: { id: c.event.id, title: c.event.title, date: c.event.date },
        item: toItemView(c.item) as ItemRecipientView,
      })),
    };
  }

  /** EVT-21, EVT-27 */
  @Post(':id/carry-over')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiCreatedResponse({ type: ItemCollectionView })
  async carryOverItems(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CarryOverDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemCollectionView> {
    const views = await this.carry.execute({
      viewerId: profile.id,
      eventId: id,
      listId: body.listId,
      itemIds: body.itemIds,
    });
    return { items: views.map(toItemView) };
  }

  /** EVT-20, étape 2 */
  @Get(':id/ideas')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: ItemCollectionView })
  async searchEventIdeas(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: IdeasQueryDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemCollectionView> {
    const views = await this.ideas.execute({ viewerId: profile.id, eventId: id, q: query.q });
    return { items: views.map(toItemView) };
  }
}
