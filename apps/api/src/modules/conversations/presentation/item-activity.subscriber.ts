import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppEvents } from '../../../shared/domain';
import { RecordItemActivity } from '../application/contract';

/** Abonné au bus de domaine : changements d'élément → suivi d'office et activité (ADR 0018). */
@Injectable()
export class ItemActivitySubscriber implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly events: AppEvents,
    private readonly record: RecordItemActivity,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe(async (event) => {
      if (event.type === 'item.changed') await this.record.execute(event);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
