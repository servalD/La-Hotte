import { Injectable } from '@nestjs/common';
import { AppEvents, Clock, IdGenerator } from '../../../shared/domain';
import { diffAccounting, participantsOf } from '../domain/accounting-state';
import { AccountingRepository } from '../domain/accounting.ports';
import { absorbShortfall } from '../domain/purchase';

/**
 * Tâches planifiées de la compta (CPT-23, CPT-64, CPT-66) : opérations du système, réclamées en
 * base pour qu'une seule instance les fasse (ADR 0019).
 */
@Injectable()
export class RunSettlementTasks {
  constructor(
    private readonly repository: AccountingRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: AppEvents,
  ) {}

  async execute(): Promise<{ reminders: number; absorbed: number }> {
    const now = this.clock.now();
    const today = now.toISOString().slice(0, 10);
    const due = await this.repository.claimDueReminders(now, today);
    for (const reminder of due) {
      this.events.publish({
        type: 'accounting.changed',
        accountingId: reminder.accountingId,
        itemId: reminder.itemId,
        change: 'settlement_nudged',
        actorId: null,
        participantIds: reminder.participantIds,
        buyerId: reminder.buyerId,
        profileIds: [reminder.participantId],
      });
    }
    let absorbed = 0;
    for (const accountingId of await this.repository.shortfallsAfterEvent(today)) {
      const result = await this.repository.mutate({
        key: { accountingId },
        actorId: null,
        operationId: this.ids.next(),
        idempotency: null,
        work: (state) => {
          if (!state) throw new Error('missing accounting');
          const next = absorbShortfall(state);
          const diff = diffAccounting(state, next, {
            header: 'ACCOUNTING_UPDATED',
            contribution: () => 'SHORTFALL_ABSORBED',
          });
          return { next, diff, response: { status: 200, body: null } };
        },
      });
      if (result.replayed) continue;
      absorbed += 1;
      this.events.publish({
        type: 'accounting.changed',
        accountingId,
        itemId: result.state.itemId,
        change: 'settlement',
        actorId: null,
        participantIds: participantsOf(result.state),
        buyerId: result.state.buyerId,
      });
    }
    return { reminders: due.length, absorbed };
  }
}
