import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { VisibilityModule } from '../visibility';
import { ListGate } from './application/list-gate';
import { ProductReferences } from './application/product-references';
import {
  AddItem,
  CopyItemProduct,
  DeleteItem,
  GetItem,
  ListItems,
  MarkItemReceived,
  UpdateItem,
  WithdrawItem,
} from './application/manage-items.use-case';
import {
  CreateList,
  DeleteList,
  GetList,
  LeaveList,
  ListLists,
  ListMembers,
  PurgeListTrash,
  RemoveListMember,
  RestoreList,
  SetListMember,
  UpdateList,
} from './application/manage-lists.use-case';
import { GetItemRule, ReadVisibilityLog, SetItemRule } from './application/manage-rules.use-case';
import {
  EngagementReader,
  ItemRepository,
  ListRepository,
  VisibilityLogRepository,
} from './domain/list.ports';
import {
  NoEngagementReader,
  PrismaItemRepository,
  PrismaListRepository,
  PrismaVisibilityLogRepository,
} from './infrastructure/prisma-list-repository';
import { ItemsController, ListsController } from './presentation/lists.controller';
import { TrashPurgeScheduler } from './presentation/trash-purge.scheduler';

/** Module `lists` : listes, éléments, rôles, succession (03). Lectures par `visibility`. */
@Module({
  imports: [VisibilityModule, CatalogModule],
  controllers: [ListsController, ItemsController],
  providers: [
    ListGate,
    ListLists,
    CreateList,
    GetList,
    UpdateList,
    DeleteList,
    RestoreList,
    PurgeListTrash,
    ListMembers,
    SetListMember,
    RemoveListMember,
    LeaveList,
    ListItems,
    AddItem,
    GetItem,
    UpdateItem,
    DeleteItem,
    MarkItemReceived,
    WithdrawItem,
    CopyItemProduct,
    TrashPurgeScheduler,
    GetItemRule,
    SetItemRule,
    ReadVisibilityLog,
    ProductReferences,
    { provide: VisibilityLogRepository, useClass: PrismaVisibilityLogRepository },
    { provide: EngagementReader, useClass: NoEngagementReader },
    { provide: ListRepository, useClass: PrismaListRepository },
    { provide: ItemRepository, useClass: PrismaItemRepository },
  ],
  exports: [ProductReferences],
})
export class ListsModule {}
