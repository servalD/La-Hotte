import { Injectable } from '@nestjs/common';
import {
  type ItemAccess,
  type ItemFacts,
  type ItemRecord,
  itemAccess,
  type ListAccess,
  type ListFacts,
  VisibilityService,
} from '../../visibility';
import { factsOf, itemFactsOf, type ListRecord } from '../domain/list';
import { ItemNotFoundError, ListNotFoundError } from '../domain/list.errors';
import { ItemRepository, ListRepository } from '../domain/list.ports';

export interface GatedList {
  readonly list: ListRecord;
  readonly facts: ListFacts;
  readonly access: ListAccess;
}

export interface GatedItem extends GatedList {
  readonly item: ItemRecord;
  readonly itemFacts: ItemFacts;
  readonly itemAccess: Exclude<ItemAccess, 'none'>;
}

/**
 * Entrée de toute lecture et de toute action (VIS-30, VIS-34) : charge les faits, demande la
 * décision à `visibility`, et répond `404` comme pour un identifiant inconnu si rien n'est visible.
 */
@Injectable()
export class ListGate {
  constructor(
    private readonly lists: ListRepository,
    private readonly items: ItemRepository,
    private readonly visibility: VisibilityService,
  ) {}

  async accessOf(viewerId: string, list: ListRecord): Promise<GatedList> {
    const facts = factsOf(list);
    return { list, facts, access: await this.visibility.accessToList(viewerId, facts) };
  }

  async list(viewerId: string, listId: string): Promise<GatedList> {
    const list = await this.lists.find(listId);
    if (!list) throw new ListNotFoundError();
    const gated = await this.accessOf(viewerId, list);
    if (gated.access.kind === 'none') throw new ListNotFoundError();
    return gated;
  }

  async item(viewerId: string, itemId: string): Promise<GatedItem> {
    const item = await this.items.find(itemId);
    if (!item) throw new ItemNotFoundError();
    const list = await this.lists.find(item.listId);
    if (!list) throw new ItemNotFoundError();
    const gated = await this.accessOf(viewerId, list);
    const facts = itemFactsOf(item);
    const decision = itemAccess(gated.access, facts, viewerId);
    if (decision === 'none') throw new ItemNotFoundError();
    return { ...gated, item, itemFacts: facts, itemAccess: decision };
  }
}
