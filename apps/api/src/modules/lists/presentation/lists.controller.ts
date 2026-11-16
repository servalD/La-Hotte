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
  ApiExtraModels,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveProfile, type ActiveProfileValue, RequiresProfile } from '../../identity';
import { parseIfMatch } from '../../../platform/http/if-match';
import {
  AddItem,
  CopyItemProduct,
  CreateList,
  DeleteItem,
  DeleteList,
  GetItem,
  GetItemRule,
  GetList,
  LeaveList,
  ListItems,
  ListLists,
  ListMembers,
  MarkItemReceived,
  ReadVisibilityLog,
  RemoveListMember,
  RestoreList,
  SetItemRule,
  SetListMember,
  UpdateItem,
  UpdateList,
  WithdrawItem,
} from '../application/contract';
import {
  AddItemDto,
  CreateListDto,
  ItemsQueryDto,
  LeaveListDto,
  ListsQueryDto,
  SetItemRuleDto,
  SetMemberDto,
  UpdateItemDto,
  UpdateListDto,
  WithdrawItemDto,
} from './dto/list.dto';
import {
  CopiedProductView,
  ITEM_VIEW_SCHEMA,
  ItemCollectionView,
  ItemGiverView,
  ItemRecipientView,
  ItemRuleView,
  type ItemViewDto,
  LIST_VIEW_SCHEMA,
  ListCollectionView,
  ListGiverView,
  ListMemberCollectionView,
  ListRecipientView,
  ListTeaserRecipientView,
  type ListView,
  VisibilityLogView,
} from './dto/list.view';
import { toItemView, toListView } from './mappers';

const UUID_PARAM = { schema: { type: 'string', format: 'uuid' } } as const;

/**
 * Listes (LST-01 à LST-20, WSH, GFT). Toute lecture passe par `visibility` ; une liste invisible
 * répond `404` comme un identifiant inconnu (VIS-34). Le profil vient de la session (API-11).
 */
@ApiTags('lists')
@ApiExtraModels(
  ListGiverView,
  ListRecipientView,
  ListTeaserRecipientView,
  ItemGiverView,
  ItemRecipientView,
)
@RequiresProfile()
@Controller('lists')
export class ListsController {
  constructor(
    private readonly listAll: ListLists,
    private readonly createList: CreateList,
    private readonly getList: GetList,
    private readonly updateList: UpdateList,
    private readonly deleteList: DeleteList,
    private readonly restoreList: RestoreList,
    private readonly members: ListMembers,
    private readonly setMember: SetListMember,
    private readonly removeMember: RemoveListMember,
    private readonly leave: LeaveList,
    private readonly itemsOf: ListItems,
    private readonly addItem: AddItem,
    private readonly visibilityLog: ReadVisibilityLog,
  ) {}

  /** VIS-14 : par l'autorité de la liste (VIS-19). */
  @Get(':id/visibility-log')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: VisibilityLogView })
  async readVisibilityLog(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<VisibilityLogView> {
    const entries = await this.visibilityLog.execute({ viewerId: profile.id, listId: id });
    return {
      items: entries.map((e) => ({
        id: e.id,
        itemId: e.itemId,
        changedBy: e.changedBy,
        before: { mode: e.before.mode, profiles: [...e.before.profiles] },
        after: { mode: e.after.mode, profiles: [...e.after.profiles] },
        at: e.at.toISOString(),
      })),
    };
  }

  @Get()
  @ApiOkResponse({ type: ListCollectionView })
  async listLists(
    @Query() query: ListsQueryDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ListCollectionView> {
    const lists = await this.listAll.execute({
      viewerId: profile.id,
      scope: query.scope ?? 'active',
    });
    return { items: lists.map(toListView) };
  }

  @Post()
  @ApiCreatedResponse({ schema: LIST_VIEW_SCHEMA })
  async createNewList(
    @Body() body: CreateListDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ListView> {
    const summary = await this.createList.execute({
      viewerId: profile.id,
      type: body.type,
      title: body.title,
      description: body.description ?? '',
      recipientIds: body.recipientIds ?? null,
      audience: body.audience ?? null,
      customAudience: body.customAudience ?? [],
      giftExistence: body.giftExistence ?? null,
      giftContent: body.giftContent ?? null,
    });
    return toListView(summary);
  }

  @Get(':id')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ schema: LIST_VIEW_SCHEMA })
  async getOneList(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ListView> {
    return toListView(await this.getList.execute({ viewerId: profile.id, listId: id }));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader({ name: 'If-Match', required: true, description: 'Version lue (API-17).' })
  @ApiOkResponse({ schema: LIST_VIEW_SCHEMA })
  async updateOneList(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateListDto,
    @Headers('if-match') ifMatch: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ListView> {
    const summary = await this.updateList.execute({
      viewerId: profile.id,
      listId: id,
      expectedVersion: parseIfMatch(ifMatch),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.recipientIds !== undefined ? { recipientIds: body.recipientIds } : {}),
      ...(body.audience !== undefined ? { audience: body.audience } : {}),
      ...(body.customAudience !== undefined ? { customAudience: body.customAudience } : {}),
      ...(body.defaultItemVisibility !== undefined
        ? { defaultItemVisibility: body.defaultItemVisibility }
        : {}),
      ...(body.visibilityEditRole !== undefined
        ? { visibilityEditRole: body.visibilityEditRole }
        : {}),
      ...(body.giftExistence !== undefined ? { giftExistence: body.giftExistence } : {}),
      ...(body.giftContent !== undefined ? { giftContent: body.giftContent } : {}),
      ...(body.archived !== undefined ? { archived: body.archived } : {}),
    });
    return toListView(summary);
  }

  /** LST-20 : à la corbeille pour 30 jours. */
  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async deleteOneList(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.deleteList.execute({ viewerId: profile.id, listId: id });
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ schema: LIST_VIEW_SCHEMA })
  async restoreOneList(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ListView> {
    return toListView(await this.restoreList.execute({ viewerId: profile.id, listId: id }));
  }

  @Get(':id/members')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: ListMemberCollectionView })
  async listMembers(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ListMemberCollectionView> {
    const members = await this.members.execute({ viewerId: profile.id, listId: id });
    return {
      items: members.map((m) => ({
        profileId: m.profileId,
        role: m.role,
        since: m.since.toISOString(),
      })),
    };
  }

  @Put(':id/members/:profileId')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiParam({ name: 'profileId', ...UUID_PARAM })
  @ApiNoContentResponse()
  async setListMember(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Body() body: SetMemberDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.setMember.execute({ viewerId: profile.id, listId: id, profileId, role: body.role });
  }

  @Delete(':id/members/:profileId')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiParam({ name: 'profileId', ...UUID_PARAM })
  @ApiNoContentResponse()
  async removeListMember(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.removeMember.execute({ viewerId: profile.id, listId: id, profileId });
  }

  /** LST-04 */
  @Post(':id/leave')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async leaveList(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: LeaveListDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.leave.execute({
      viewerId: profile.id,
      listId: id,
      successorId: body.successorProfileId ?? null,
    });
  }

  @Get(':id/items')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: ItemCollectionView })
  async listItems(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ItemsQueryDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemCollectionView> {
    const views = await this.itemsOf.execute({
      viewerId: profile.id,
      listId: id,
      sort: query.sort ?? 'position',
    });
    return { items: views.map(toItemView) };
  }

  @Post(':id/items')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiCreatedResponse({ schema: ITEM_VIEW_SCHEMA })
  async addListItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AddItemDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemViewDto> {
    const view = await this.addItem.execute({
      viewerId: profile.id,
      listId: id,
      productId: body.productId,
      ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
      ...(body.unitPriceMinor !== undefined ? { unitPriceMinor: body.unitPriceMinor } : {}),
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.manyWelcome !== undefined ? { manyWelcome: body.manyWelcome } : {}),
      ...(body.isSuggestion !== undefined ? { isSuggestion: body.isSuggestion } : {}),
      ...(body.intendedRecipientId !== undefined
        ? { intendedRecipientId: body.intendedRecipientId }
        : {}),
      ...(body.shownToRecipient !== undefined ? { shownToRecipient: body.shownToRecipient } : {}),
    });
    return toItemView(view);
  }
}

/** Éléments (LST-10 à LST-19). Un élément invisible répond `404` (VIS-34). */
@ApiTags('items')
@ApiExtraModels(ItemGiverView, ItemRecipientView)
@RequiresProfile()
@Controller('items')
export class ItemsController {
  constructor(
    private readonly getItem: GetItem,
    private readonly updateItem: UpdateItem,
    private readonly deleteItem: DeleteItem,
    private readonly received: MarkItemReceived,
    private readonly withdraw: WithdrawItem,
    private readonly copy: CopyItemProduct,
    private readonly getRule: GetItemRule,
    private readonly setRule: SetItemRule,
  ) {}

  /** VIS-19 : par qui peut la modifier ; sinon `403 VISIBILITY_EDIT_FORBIDDEN`. */
  @Get(':id/visibility')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: ItemRuleView })
  async getItemRule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemRuleView> {
    const rule = await this.getRule.execute({ viewerId: profile.id, itemId: id });
    return {
      mode: rule.mode,
      profiles: [...rule.profiles],
      outsideAudience: [...rule.outsideAudience],
      version: rule.version,
    };
  }

  /** VIS-10 à VIS-16, LST-03 ; tracé (VIS-14). */
  @Put(':id/visibility')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader({ name: 'If-Match', required: true, description: 'Version de l’élément (API-17).' })
  @ApiOkResponse({ type: ItemRuleView })
  async setItemRule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SetItemRuleDto,
    @Headers('if-match') ifMatch: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemRuleView> {
    const rule = await this.setRule.execute({
      viewerId: profile.id,
      itemId: id,
      expectedVersion: parseIfMatch(ifMatch),
      mode: body.mode,
      profileIds: body.profileIds,
    });
    return {
      mode: rule.mode,
      profiles: [...rule.profiles],
      outsideAudience: [...rule.outsideAudience],
      version: rule.version,
    };
  }

  @Get(':id')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ schema: ITEM_VIEW_SCHEMA })
  async getOneItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemViewDto> {
    return toItemView(await this.getItem.execute({ viewerId: profile.id, itemId: id }));
  }

  @Patch(':id')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader({ name: 'If-Match', required: true, description: 'Version lue (API-17).' })
  @ApiOkResponse({ schema: ITEM_VIEW_SCHEMA })
  async updateOneItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateItemDto,
    @Headers('if-match') ifMatch: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemViewDto> {
    const view = await this.updateItem.execute({
      viewerId: profile.id,
      itemId: id,
      expectedVersion: parseIfMatch(ifMatch),
      changes: {
        ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
        ...(body.unitPriceMinor !== undefined ? { unitPriceMinor: body.unitPriceMinor } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.manyWelcome !== undefined ? { manyWelcome: body.manyWelcome } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.intendedRecipientId !== undefined
          ? { intendedRecipientId: body.intendedRecipientId }
          : {}),
        ...(body.shownToRecipient !== undefined ? { shownToRecipient: body.shownToRecipient } : {}),
      },
    });
    return toItemView(view);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async deleteOneItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.deleteItem.execute({ viewerId: profile.id, itemId: id });
  }

  /** LST-13, LST-18 */
  @Post(':id/received')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: ItemRecipientView })
  async markItemReceived(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemViewDto> {
    return toItemView(
      await this.received.execute({ viewerId: profile.id, itemId: id, received: true }),
    );
  }

  @Delete(':id/received')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: ItemRecipientView })
  async unmarkItemReceived(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemViewDto> {
    return toItemView(
      await this.received.execute({ viewerId: profile.id, itemId: id, received: false }),
    );
  }

  /** LST-15 */
  @Post(':id/withdraw')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async withdrawItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: WithdrawItemDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.withdraw.execute({ viewerId: profile.id, itemId: id, reason: body.reason });
  }

  /** ART-04 : copie de la fiche dans mes fiches. */
  @Post(':id/copy')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiCreatedResponse({ type: CopiedProductView })
  async copyItemProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<CopiedProductView> {
    return this.copy.execute({ viewerId: profile.id, itemId: id });
  }
}
