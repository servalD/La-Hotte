import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppEvents } from '../../../shared/domain';
import { ReconcileItemCost } from '../application/contract';

/** Abonné au bus : un élément modifié fait relire son coût par la compta (CPT-57, ADR 0019). */
@Injectable()
export class ItemCostSubscriber implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly events: AppEvents,
    private readonly reconcile: ReconcileItemCost,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe(async (event) => {
      if (event.type === 'item.changed' && event.change === 'updated') {
        await this.reconcile.execute({ itemId: event.itemId, actorId: event.actorId });
      }
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
