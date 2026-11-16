import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import { ProductCatalog, ProductNotFoundError } from '../../catalog';
import {
  addRight,
  canActAsRecipient,
  canMarkReceived,
  canEditItem,
  type ItemPriority,
  itemAccess,
  itemCriteria,
  type ItemView,
  projectItem,
} from '../../visibility';
import {
  type ItemChanges,
  itemChangesProblem,
  itemFactsOf,
  type ItemSort,
  type WithdrawnReason,
} from '../domain/list';
import {
  ItemInvalidError,
  ItemNotFoundError,
  ListActionForbiddenError,
  ListVersionMismatchError,
} from '../domain/list.errors';
import { EventLookup, ItemRepository } from '../domain/list.ports';
import { type GatedItem, ListGate } from './list-gate';
import { visibleOriginEvents } from './manage-event-lists.use-case';

/** GET /lists/{id}/items : filtré en base (VIS-31), puis élément par élément (VIS-30). */
@Injectable()
export class ListItems {
  constructor(
    private readonly gate: ListGate,
    private readonly items: ItemRepository,
    private readonly lookup: EventLookup,
  ) {}

  async execute(input: { viewerId: string; listId: string; sort: ItemSort }): Promise<ItemView[]> {
    const { access } = await this.gate.list(input.viewerId, input.listId);
    const criteria = itemCriteria(access, input.viewerId);
    if (!criteria) return [];
    const rows = await this.items.listItems(input.listId, criteria, input.sort);
    // EVT-28 : seule la vue offreur porte la mention ; inutile de lire les événements sinon.
    const visibleEventIds =
      access.kind === 'giver'
        ? await visibleOriginEvents(this.lookup, input.viewerId, rows)
        : new Set<string>();
    const views: ItemView[] = [];
    for (const row of rows) {
      const view = projectItem(
        itemAccess(access, itemFactsOf(row), input.viewerId),
        row,
        input.viewerId,
        { visibleEventIds },
      );
      if (view) views.push(view);
    }
    return views;
  }
}

export interface AddItemInput {
  readonly viewerId: string;
  readonly listId: string;
  readonly productId: string;
  readonly quantity?: number;
  readonly unitPriceMinor?: number | null;
  readonly currency?: string;
  readonly priority?: ItemPriority;
  readonly note?: string;
  readonly manyWelcome?: boolean;
  readonly isSuggestion?: boolean;
  readonly intendedRecipientId?: string | null;
  readonly shownToRecipient?: boolean;
}

/** POST /lists/{id}/items (ART-03, ART-05, LST-02, WSH-04, WSH-07, GFT-02). */
@Injectable()
export class AddItem {
  constructor(
    private readonly gate: ListGate,
    private readonly items: ItemRepository,
    private readonly catalog: ProductCatalog,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: AddItemInput): Promise<ItemView> {
    const { list, facts, access } = await this.gate.list(input.viewerId, input.listId);
    const right = addRight(facts, access);
    if (right === 'none') throw new ListActionForbiddenError();
    const isSuggestion =
      right === 'suggestion' ? true : right === 'item' ? false : (input.isSuggestion ?? false);
    if (input.isSuggestion === true && right === 'item') throw new ListActionForbiddenError();
    const giftOnly =
      (input.intendedRecipientId !== undefined && input.intendedRecipientId !== null) ||
      input.shownToRecipient !== undefined;
    if (giftOnly && list.type !== 'GIFTLIST') throw new ItemInvalidError();
    if (input.intendedRecipientId && !list.recipients.includes(input.intendedRecipientId)) {
      throw new ItemInvalidError();
    }
    if (itemChangesProblem(input)) throw new ItemInvalidError();
    // ART-05 : on n'ajoute que ses propres fiches ; une autre se copie d'abord (ART-04).
    const owned = await this.catalog.findOwned(input.viewerId, input.productId);
    if (!owned) throw new ProductNotFoundError();
    // REP-10 (revue SEC-40, I3) : une fiche déjà publiée ne disparaît pas du répertoire d'un
    // destinataire ; l'élément référence une copie privée (ART-04).
    const product =
      owned.shareLevel !== 'PRIVATE' && list.recipients.some((id) => id !== input.viewerId)
        ? await this.catalog.copy(owned.id, input.viewerId)
        : owned;
    const created = await this.items.create({
      id: this.ids.next(),
      listId: list.id,
      productId: product.id,
      addedBy: input.viewerId,
      quantity: input.quantity ?? 1,
      // ART-03 : le prix est copié sur l'élément.
      unitPriceMinor:
        input.unitPriceMinor !== undefined ? input.unitPriceMinor : product.unitPriceMinor,
      currency: input.currency ?? product.currency,
      priority: input.priority ?? 'WANT',
      note: input.note ?? '',
      manyWelcome: input.manyWelcome ?? false,
      visibilityMode: list.defaultItemVisibility,
      isSuggestion,
      intendedRecipientId: input.intendedRecipientId ?? null,
      shownToRecipient: input.shownToRecipient ?? false,
    });
    const view = projectItem(
      itemAccess(access, itemFactsOf(created), input.viewerId),
      created,
      input.viewerId,
    );
    if (!view) throw new ItemNotFoundError();
    return view;
  }
}

/** GET /items/{id} */
@Injectable()
export class GetItem {
  constructor(
    private readonly gate: ListGate,
    private readonly lookup: EventLookup,
  ) {}

  async execute(input: { viewerId: string; itemId: string }): Promise<ItemView> {
    const gated = await this.gate.item(input.viewerId, input.itemId);
    const visibleEventIds =
      gated.itemAccess === 'giver'
        ? await visibleOriginEvents(this.lookup, input.viewerId, [gated.item])
        : new Set<string>();
    const view = projectItem(gated.itemAccess, gated.item, input.viewerId, { visibleEventIds });
    if (!view) throw new ItemNotFoundError();
    return view;
  }
}

/** PATCH /items/{id} (ART-06, LST-02, LST-06, GFT-02). */
@Injectable()
export class UpdateItem {
  constructor(
    private readonly gate: ListGate,
    private readonly items: ItemRepository,
  ) {}

  async execute(input: {
    viewerId: string;
    itemId: string;
    expectedVersion: number;
    changes: ItemChanges;
  }): Promise<ItemView> {
    const gated = await this.gate.item(input.viewerId, input.itemId);
    if (!canEditItem(gated.facts, gated.access, gated.itemFacts, input.viewerId)) {
      throw new ListActionForbiddenError();
    }
    const { changes } = input;
    const giftOnly =
      changes.intendedRecipientId !== undefined || changes.shownToRecipient !== undefined;
    if (giftOnly && gated.list.type !== 'GIFTLIST') throw new ItemInvalidError();
    if (
      changes.intendedRecipientId &&
      !gated.list.recipients.includes(changes.intendedRecipientId)
    ) {
      throw new ItemInvalidError();
    }
    if (itemChangesProblem(changes)) throw new ItemInvalidError();
    const result = await this.items.update({
      itemId: gated.item.id,
      expectedVersion: input.expectedVersion,
      changes:
        changes.position !== undefined && gated.access.kind !== 'giver'
          ? {
              ...changes,
              position: await this.reorderAsRecipient(gated, changes.position, input.viewerId),
            }
          : changes,
    });
    if (result === 'missing') throw new ItemNotFoundError();
    if (result === 'version') throw new ListVersionMismatchError();
    const view = projectItem(
      itemAccess(gated.access, itemFactsOf(result), input.viewerId),
      result,
      input.viewerId,
    );
    if (!view) throw new ItemNotFoundError();
    return view;
  }

  /**
   * VIS-35 (revue SEC-40, R1) : pour un destinataire, la position demandée est un rang parmi les
   * éléments qu'il voit. Les places que ces éléments occupent sont redistribuées entre eux ; les
   * éléments qu'il ne voit pas gardent la leur. Rend la place réelle de l'élément déplacé.
   */
  private async reorderAsRecipient(
    gated: GatedItem,
    rank: number,
    viewerId: string,
  ): Promise<number> {
    const criteria = itemCriteria(gated.access, viewerId);
    const visible = criteria
      ? (await this.items.listItems(gated.list.id, criteria, 'position')).filter(
          (row) => itemAccess(gated.access, itemFactsOf(row), viewerId) !== 'none',
        )
      : [];
    const slots = visible.map((row) => row.position).sort((a, b) => a - b);
    const others = visible.filter((row) => row.id !== gated.item.id);
    const at = Math.min(Math.max(rank, 0), others.length);
    const order = [...others.slice(0, at), gated.item, ...others.slice(at)];
    let own = gated.item.position;
    for (const [index, row] of order.entries()) {
      const slot = slots[index] ?? row.position;
      if (row.id === gated.item.id) {
        own = slot;
        continue;
      }
      if (row.position === slot) continue;
      const moved = await this.items.update({
        itemId: row.id,
        expectedVersion: row.version,
        changes: { position: slot },
      });
      if (moved === 'missing' || moved === 'version') throw new ListVersionMismatchError();
    }
    return own;
  }
}

/** DELETE /items/{id} (LST-02, WSH-07). */
@Injectable()
export class DeleteItem {
  constructor(
    private readonly gate: ListGate,
    private readonly items: ItemRepository,
  ) {}

  async execute(input: { viewerId: string; itemId: string }): Promise<void> {
    const gated = await this.gate.item(input.viewerId, input.itemId);
    if (!canEditItem(gated.facts, gated.access, gated.itemFacts, input.viewerId)) {
      throw new ListActionForbiddenError();
    }
    await this.items.delete(gated.item.id);
  }
}

/**
 * POST/DELETE /items/{id}/received (LST-13, LST-18, GFT-11) : permis sur la liste d'un événement
 * clos (EVT-38). Rendu dans la vue du demandeur (destinataire, ou responsable d'une giftlist).
 */
@Injectable()
export class MarkItemReceived {
  constructor(
    private readonly gate: ListGate,
    private readonly items: ItemRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: { viewerId: string; itemId: string; received: boolean }): Promise<ItemView> {
    const gated = await this.gate.item(input.viewerId, input.itemId);
    if (!canMarkReceived(gated.facts, gated.access, gated.itemFacts, input.viewerId)) {
      throw new ListActionForbiddenError();
    }
    const updated = await this.items.setReceived(
      gated.item.id,
      input.received ? (gated.item.receivedAt ?? this.clock.now()) : null,
    );
    const view = updated ? projectItem(gated.itemAccess, updated, input.viewerId) : null;
    if (!view) throw new ItemNotFoundError();
    return view;
  }
}

/** POST /items/{id}/withdraw (LST-15, LST-19). */
@Injectable()
export class WithdrawItem {
  constructor(
    private readonly gate: ListGate,
    private readonly items: ItemRepository,
  ) {}

  async execute(input: {
    viewerId: string;
    itemId: string;
    reason: WithdrawnReason;
  }): Promise<void> {
    const gated = await this.gate.item(input.viewerId, input.itemId);
    if (!canActAsRecipient(gated.facts, gated.access, gated.itemFacts, input.viewerId)) {
      throw new ListActionForbiddenError();
    }
    // Phase 4 : notification des offreurs engagés (LST-15).
    await this.items.withdraw(gated.item.id, input.reason);
  }
}

/** POST /items/{id}/copy : nouvelle fiche au copieur (ART-04), depuis un élément qu'il voit. */
@Injectable()
export class CopyItemProduct {
  constructor(
    private readonly gate: ListGate,
    private readonly catalog: ProductCatalog,
  ) {}

  async execute(input: { viewerId: string; itemId: string }): Promise<{ productId: string }> {
    const gated = await this.gate.item(input.viewerId, input.itemId);
    const copy = await this.catalog.copy(gated.item.product.id, input.viewerId);
    return { productId: copy.id };
  }
}
