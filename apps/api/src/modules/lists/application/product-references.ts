import { Injectable } from '@nestjs/common';
import { canEditItemRule, type ProductReference } from '../../visibility';
import { VisibilityEditForbiddenError } from '../domain/list.errors';
import { ItemRepository } from '../domain/list.ports';
import { ListGate } from './list-gate';
import { SetItemRule } from './manage-rules.use-case';

/**
 * Surface de `lists` pour le répertoire (REP-06, REP-07, REP-10) : les éléments qui référencent une
 * fiche, et le passage à `TOUS` de ceux qui sont cachés, par qui peut en modifier la règle.
 */
@Injectable()
export class ProductReferences {
  constructor(
    private readonly items: ItemRepository,
    private readonly gate: ListGate,
    private readonly setRule: SetItemRule,
  ) {}

  async of(productIds: readonly string[]): Promise<Map<string, ProductReference[]>> {
    const out = new Map<string, ProductReference[]>();
    for (const reference of await this.items.referencesOf(productIds)) {
      const list = out.get(reference.productId) ?? [];
      list.push({
        rule: reference.rule,
        listRecipients: reference.listRecipients,
        surpriseFor: reference.surpriseFor,
      });
      out.set(reference.productId, list);
    }
    return out;
  }

  /**
   * REP-06, premier choix : les éléments cachés qui référencent la fiche repassent en `TOUS`
   * (tracé, VIS-14). Tout ou rien : chaque élément est vérifié avant le premier changement.
   */
  async makeVisibleToAll(viewerId: string, productId: string): Promise<void> {
    const hidden = (await this.items.referencesOf([productId])).filter(
      (reference) => reference.rule.mode !== 'ALL',
    );
    for (const reference of hidden) {
      const gated = await this.gate.item(viewerId, reference.itemId).catch(() => null);
      if (!gated || !canEditItemRule(gated.facts, gated.access, gated.itemFacts, viewerId)) {
        throw new VisibilityEditForbiddenError();
      }
    }
    for (const reference of hidden) {
      await this.setRule.execute({
        viewerId,
        itemId: reference.itemId,
        expectedVersion: reference.version,
        mode: 'ALL',
        profileIds: [],
      });
    }
  }
}
