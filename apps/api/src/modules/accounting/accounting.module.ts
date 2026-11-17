import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { ConversationsModule } from '../conversations';
import { EventsModule } from '../events';
import { ListsModule } from '../lists';
import { VisibilityModule } from '../visibility';
import { AccountingGate } from './application/accounting-gate';
import {
  AccountingViews,
  DecideAccountingReview,
  ReconcileItemCost,
  RemoveContribution,
  SetAccountingOptions,
  SetContribution,
} from './application/manage-contributions.use-case';
import { AccountingPeople, AccountingRepository } from './domain/accounting.ports';
import {
  PrismaAccountingPeople,
  PrismaAccountingRepository,
} from './infrastructure/prisma-accounting';
import { AccountingController } from './presentation/accounting.controller';
import { ItemCostSubscriber } from './presentation/item-cost.subscriber';
import { PurchaseController } from './presentation/purchase.controller';
import {
  DecideBuyerRequest,
  GetCart,
  LowerContribution,
  MarkPurchased,
  NotifyShortfall,
  PurchaseReceipts,
  RequestBuyer,
  UncheckPurchase,
} from './application/manage-purchase.use-case';

/** Module `accounting` : participations, acheteur, achat, règlements, soldes (07, ADR 0019). */
@Module({
  imports: [ListsModule, VisibilityModule, ConversationsModule, EventsModule, CatalogModule],
  controllers: [AccountingController, PurchaseController],
  providers: [
    AccountingGate,
    AccountingViews,
    SetContribution,
    RemoveContribution,
    SetAccountingOptions,
    DecideAccountingReview,
    ReconcileItemCost,
    ItemCostSubscriber,
    MarkPurchased,
    UncheckPurchase,
    LowerContribution,
    RequestBuyer,
    DecideBuyerRequest,
    NotifyShortfall,
    PurchaseReceipts,
    GetCart,
    { provide: AccountingRepository, useClass: PrismaAccountingRepository },
    { provide: AccountingPeople, useClass: PrismaAccountingPeople },
  ],
  exports: [AccountingRepository],
})
export class AccountingModule {}
