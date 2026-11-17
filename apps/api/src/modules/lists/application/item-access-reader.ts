import { Injectable } from '@nestjs/common';
import {
  type AccountingSubject,
  activityThread,
  canModerateComment,
  type ItemAccess,
  itemAccess,
  type ListAccess,
  type Thread,
  type ThreadAccess,
  threadAccess,
} from '../../visibility';
import { factsOf, itemFactsOf, type ListRecord } from '../domain/list';
import { ItemRepository, ListRepository } from '../domain/list.ports';
import { ListGate } from './list-gate';

/** Ce qu'un profil peut faire des fils d'un élément qu'il voit (COM-11). */
export interface ItemAccessContext {
  readonly itemId: string;
  readonly listId: string;
  readonly view: Exclude<ItemAccess, 'none'>;
  readonly threads: ThreadAccess;
  /** COM-15 : autorité de la liste. */
  readonly canModerate: boolean;
}

/** Faits d'un élément lus par la compta (ADR 0019) ; la décision reste au moteur. */
export interface AccountingItem {
  readonly subject: AccountingSubject;
  readonly itemId: string;
  readonly listId: string;
  readonly eventId: string | null;
  readonly title: string;
  /** CPT-11 : lien marchand de la fiche. */
  readonly sourceUrl: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number | null;
  readonly currency: string;
  readonly recipients: readonly string[];
}

/** Ce qu'un profil voit d'un élément pour en parler (titres relus à l'affichage, NOT-11). */
export interface ItemSummary {
  readonly itemId: string;
  readonly listId: string;
  readonly itemTitle: string;
  readonly listTitle: string;
  readonly view: Exclude<ItemAccess, 'none'>;
  readonly threads: ThreadAccess;
}

/**
 * Lecteur d'accès exposé aux modules `conversations`, `notifications` et `realtime` (ADR 0018) :
 * charge les faits, laisse décider le moteur, rend la décision pour un ou plusieurs profils. Aucune
 * règle ici (invariant 2).
 */
@Injectable()
export class ItemAccessReader {
  constructor(
    private readonly gate: ListGate,
    private readonly lists: ListRepository,
    private readonly items: ItemRepository,
  ) {}

  /** `null` : élément inconnu ou invisible de ce profil (VIS-34). */
  async forViewer(viewerId: string, itemId: string): Promise<ItemAccessContext | null> {
    return (await this.forViewers([viewerId], itemId)).get(viewerId) ?? null;
  }

  /** Décision pour chaque profil ; ceux qui ne voient pas l'élément sont absents. */
  async forViewers(
    viewerIds: readonly string[],
    itemId: string,
  ): Promise<Map<string, ItemAccessContext>> {
    const result = new Map<string, ItemAccessContext>();
    const loaded = await this.load(itemId);
    if (!loaded) return result;
    const { list, item } = loaded;
    const facts = factsOf(list);
    const itemFacts = itemFactsOf(item);
    for (const viewerId of new Set(viewerIds)) {
      const access = await this.gate.accessOf(viewerId, list).then((g) => g.access);
      const view = itemAccess(access, itemFacts, viewerId);
      if (view === 'none') continue;
      result.set(viewerId, {
        itemId,
        listId: list.id,
        view,
        threads: threadAccess(facts, access, itemFacts, viewerId),
        canModerate: canModerateComment(facts, viewerId),
      });
    }
    return result;
  }

  /** COM-14 : fil où va l'activité née du geste de `actorId` ; `null` si l'élément a disparu. */
  async activityThreadOf(itemId: string, actorId: string | null): Promise<Thread | null> {
    const loaded = await this.load(itemId);
    if (!loaded) return null;
    return activityThread(factsOf(loaded.list), itemFactsOf(loaded.item), actorId);
  }

  /** NOT-11 : titres d'un élément vu par ce profil, ou `null`. */
  async summary(viewerId: string, itemId: string): Promise<ItemSummary | null> {
    const loaded = await this.load(itemId);
    if (!loaded) return null;
    const { list, item } = loaded;
    const access = (await this.gate.accessOf(viewerId, list)).access;
    const itemFacts = itemFactsOf(item);
    const view = itemAccess(access, itemFacts, viewerId);
    if (view === 'none') return null;
    return {
      itemId,
      listId: list.id,
      itemTitle: item.product.title,
      listTitle: list.title,
      view,
      threads: threadAccess(factsOf(list), access, itemFacts, viewerId),
    };
  }

  /**
   * Faits d'un élément pour la compta (ADR 0019) : le sujet que le moteur juge
   * (`accountingLevel`, `canContribute`) et le coût de l'élément. Aucune décision ici ; `null`
   * si l'élément a disparu.
   */
  async accountingSubject(viewerId: string, itemId: string): Promise<AccountingItem | null> {
    const loaded = await this.load(itemId);
    if (!loaded) return null;
    const { list, item } = loaded;
    const { access } = await this.gate.accessOf(viewerId, list);
    return {
      subject: { list: factsOf(list), access, item: itemFactsOf(item) },
      itemId: item.id,
      listId: list.id,
      eventId: list.event?.id ?? null,
      title: item.product.title,
      sourceUrl: item.product.sourceUrl,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      currency: item.currency,
      recipients: list.recipients,
    };
  }

  /** NOT-19 : destinataires de la liste de l'élément (lus pour un profil qui le voit déjà). */
  async recipientsOf(itemId: string): Promise<readonly string[]> {
    const loaded = await this.load(itemId);
    return loaded ? loaded.list.recipients : [];
  }

  /** RT-09 : accès d'un profil à une liste (salon `list:{id}`). */
  async listAccess(viewerId: string, listId: string): Promise<ListAccess['kind']> {
    const list = await this.lists.find(listId);
    if (!list) return 'none';
    return (await this.gate.accessOf(viewerId, list)).access.kind;
  }

  /** NOT-11 : titre d'une liste vue par ce profil, ou `null`. */
  async listTitle(viewerId: string, listId: string): Promise<string | null> {
    const list = await this.lists.find(listId);
    if (!list) return null;
    const { access } = await this.gate.accessOf(viewerId, list);
    return access.kind === 'none' ? null : list.title;
  }

  private async load(itemId: string) {
    const item = await this.items.find(itemId);
    if (!item) return null;
    const list: ListRecord | null = await this.lists.find(item.listId);
    if (!list) return null;
    return { list, item };
  }
}
