import type { ItemPriority, ItemStatus, VisibilityMode } from './facts';
import type { ItemAccess } from './rules';

// Vues construites champ par champ (ADR 0004, API-12, VIS-35) : la vue destinataire ne contient
// aucun champ d'offreur, ni même son nom. Jamais `...item` : un champ ajouté à l'élément n'atteint
// une vue que si on l'y écrit ici.

/** Fiche telle qu'un élément la montre (ART-01). */
export interface ItemProductRecord {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly imageKey: string | null;
  readonly merchant: string | null;
  readonly sourceUrl: string | null;
}

/** Élément lu en base, avec tout ce qu'un offreur peut voir en phase 2. */
export interface ItemRecord {
  readonly id: string;
  readonly listId: string;
  readonly product: ItemProductRecord;
  readonly quantity: number;
  readonly unitPriceMinor: bigint | null;
  readonly currency: string;
  readonly priority: ItemPriority;
  readonly note: string;
  readonly manyWelcome: boolean;
  readonly position: number;
  readonly visibilityMode: VisibilityMode;
  readonly visibilityProfiles: readonly string[];
  readonly status: ItemStatus;
  readonly isSuggestion: boolean;
  readonly shownToRecipient: boolean;
  readonly receivedAt: Date | null;
  readonly addedBy: string | null;
  readonly intendedRecipientId: string | null;
  readonly createdAt: Date;
  readonly version: number;
}

export interface ProductPart {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly imageKey: string | null;
  readonly merchant: string | null;
  readonly sourceUrl: string | null;
}

/** VIS-35 : liste fermée. */
export interface ItemRecipientView {
  readonly view: 'recipient';
  readonly id: string;
  readonly listId: string;
  readonly product: ProductPart;
  readonly quantity: number;
  readonly unitPriceMinor: bigint | null;
  readonly currency: string;
  readonly priority: ItemPriority;
  readonly note: string;
  readonly manyWelcome: boolean;
  readonly position: number;
  /** VIS-11 */
  readonly hidden: boolean;
  /** LST-16 : seul « reçu » est distingué. */
  readonly received: boolean;
  readonly receivedAt: Date | null;
  readonly mine: boolean;
  /** Ne bouge jamais pour une écriture d'offreur (réservation, part : autres tables). */
  readonly version: number;
}

/** LST-12, LST-18 : l'état montré à un offreur ; `RECEIVED` tant que le reçu est coché. */
export type GiverItemStatus = 'OPEN' | 'RESERVED' | 'PURCHASED' | 'RECEIVED';

export interface ItemGiverView {
  readonly view: 'giver';
  readonly id: string;
  readonly listId: string;
  readonly product: ProductPart;
  readonly quantity: number;
  readonly unitPriceMinor: bigint | null;
  readonly currency: string;
  readonly priority: ItemPriority;
  readonly note: string;
  readonly manyWelcome: boolean;
  readonly position: number;
  readonly hidden: boolean;
  readonly visibilityMode: VisibilityMode;
  readonly status: GiverItemStatus;
  readonly isSuggestion: boolean;
  readonly shownToRecipient: boolean;
  readonly intendedRecipientId: string | null;
  readonly addedBy: string | null;
  readonly mine: boolean;
  readonly createdAt: Date;
  readonly version: number;
}

export type ItemView = ItemRecipientView | ItemGiverView;

function productPart(product: ItemProductRecord): ProductPart {
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    imageKey: product.imageKey,
    merchant: product.merchant,
    sourceUrl: product.sourceUrl,
  };
}

function recipientView(item: ItemRecord, viewerId: string): ItemRecipientView {
  return {
    view: 'recipient',
    id: item.id,
    listId: item.listId,
    product: productPart(item.product),
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    currency: item.currency,
    priority: item.priority,
    note: item.note,
    manyWelcome: item.manyWelcome,
    position: item.position,
    hidden: item.visibilityMode !== 'ALL',
    received: item.receivedAt !== null,
    receivedAt: item.receivedAt,
    mine: item.addedBy === viewerId,
    version: item.version,
  };
}

function giverStatus(item: ItemRecord): GiverItemStatus {
  if (item.receivedAt !== null) return 'RECEIVED';
  // `WITHDRAWN` n'atteint jamais une vue : écarté par `projectItem` (LST-19).
  return item.status as Exclude<ItemRecord['status'], 'WITHDRAWN'>;
}

function giverView(item: ItemRecord, viewerId: string): ItemGiverView {
  return {
    view: 'giver',
    id: item.id,
    listId: item.listId,
    product: productPart(item.product),
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    currency: item.currency,
    priority: item.priority,
    note: item.note,
    manyWelcome: item.manyWelcome,
    position: item.position,
    hidden: item.visibilityMode !== 'ALL',
    visibilityMode: item.visibilityMode,
    status: giverStatus(item),
    isSuggestion: item.isSuggestion,
    shownToRecipient: item.shownToRecipient,
    intendedRecipientId: item.intendedRecipientId,
    addedBy: item.addedBy,
    mine: item.addedBy === viewerId,
    createdAt: item.createdAt,
    version: item.version,
  };
}

/** Vue d'un élément selon la décision de `itemAccess` ; `null` si rien n'est montré. */
export function projectItem(
  access: ItemAccess,
  item: ItemRecord,
  viewerId: string,
): ItemView | null {
  // Seconde barrière de LST-19 : un élément retiré n'a pas de vue, quelle que soit la décision.
  if (item.status === 'WITHDRAWN') return null;
  switch (access) {
    case 'none':
      return null;
    case 'recipient':
      return recipientView(item, viewerId);
    case 'giver':
      return giverView(item, viewerId);
  }
}
