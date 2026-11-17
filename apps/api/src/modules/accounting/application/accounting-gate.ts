import { Injectable } from '@nestjs/common';
import { type AccountingItem, ItemAccessReader } from '../../lists';
import { type AccountingLevel, accountingLevel, canContribute } from '../../visibility';
import { type AccountingState, participantsOf } from '../domain/accounting-state';
import { AccountingRepository } from '../domain/accounting.ports';

export interface GatedAccounting {
  readonly item: AccountingItem | null;
  readonly state: AccountingState | null;
  readonly level: AccountingLevel;
  readonly canContribute: boolean;
}

/**
 * Charge les faits d'un élément et de sa fiche, et laisse le moteur décider (invariant 2) :
 * aucune règle ici.
 */
@Injectable()
export class AccountingGate {
  constructor(
    private readonly items: ItemAccessReader,
    private readonly accounting: AccountingRepository,
  ) {}

  async forItem(viewerId: string, itemId: string): Promise<GatedAccounting> {
    const [item, state] = await Promise.all([
      this.items.accountingSubject(viewerId, itemId),
      this.accounting.findByItem(itemId),
    ]);
    return this.decide(viewerId, item, state);
  }

  decide(
    viewerId: string,
    item: AccountingItem | null,
    state: AccountingState | null,
  ): GatedAccounting {
    const facts = {
      participants: state ? participantsOf(state) : [],
      buyerId: state?.buyerId ?? null,
    };
    const level = item || state ? accountingLevel(item?.subject ?? null, facts, viewerId) : 'none';
    return {
      item,
      state,
      level,
      canContribute: item !== null && level !== 'none' && canContribute(item.subject, viewerId),
    };
  }
}
