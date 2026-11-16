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
  readonly unitPriceMinor: number | null;
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
  /** EVT-27 : l'élément a été repris dans une autre liste. */
  readonly carriedForward: boolean;
  /** EVT-27, EVT-28 : origine d'une reprise, avec son état réel (jamais montré au destinataire). */
  readonly carryOrigin: CarryOriginRecord | null;
}

export interface CarryOriginRecord {
  readonly status: ItemStatus;
  /** Événement de la liste d'origine, s'il en a un. */
  readonly event: { readonly id: string; readonly title: string; readonly date: string } | null;
}

/** EVT-28 : mention offreur d'une reprise. */
export interface CarriedFromPart {
  readonly status: 'RESERVED' | 'PURCHASED';
  /** Absent si le lecteur ne voit pas l'ancien événement. */
  readonly event: { readonly title: string; readonly date: string } | null;
}

/** Ce que la projection doit savoir du lecteur au-delà de l'élément. */
export interface ProjectionContext {
  /** EVT-28 : événements que le lecteur voit (pour titrer la mention de reprise). */
  readonly visibleEventIds?: ReadonlySet<string>;
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
  readonly unitPriceMinor: number | null;
  readonly currency: string;
  readonly priority: ItemPriority;
  readonly note: string;
  readonly manyWelcome: boolean;
  /** VIS-35 : pas de position brute (ses trous trahiraient ce qui est caché). */
  /** VIS-11 */
  readonly hidden: boolean;
  /** LST-16 : seul « reçu » est distingué. */
  readonly received: boolean;
  readonly receivedAt: Date | null;
  readonly mine: boolean;
  /** EVT-27 : reporté vers une autre liste, son propre geste. */
  readonly carriedForward: boolean;
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
  readonly unitPriceMinor: number | null;
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
  readonly carriedForward: boolean;
  readonly carriedFrom: CarriedFromPart | null;
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
    hidden: item.visibilityMode !== 'ALL',
    received: item.receivedAt !== null,
    receivedAt: item.receivedAt,
    mine: item.addedBy === viewerId,
    carriedForward: item.carriedForward,
    version: item.version,
  };
}

/** EVT-28 : seulement pour une origine réservée ou achetée. */
function carriedFrom(item: ItemRecord, context: ProjectionContext): CarriedFromPart | null {
  const origin = item.carryOrigin;
  if (!origin || (origin.status !== 'RESERVED' && origin.status !== 'PURCHASED')) return null;
  const event =
    origin.event && context.visibleEventIds?.has(origin.event.id)
      ? { title: origin.event.title, date: origin.event.date }
      : null;
  return { status: origin.status, event };
}

function giverStatus(item: ItemRecord): GiverItemStatus {
  if (item.receivedAt !== null) return 'RECEIVED';
  // `WITHDRAWN` n'atteint jamais une vue : écarté par `projectItem` (LST-19).
  return item.status as Exclude<ItemRecord['status'], 'WITHDRAWN'>;
}

function giverView(item: ItemRecord, viewerId: string, context: ProjectionContext): ItemGiverView {
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
    carriedForward: item.carriedForward,
    carriedFrom: carriedFrom(item, context),
    version: item.version,
  };
}

/** Vue d'un élément selon la décision de `itemAccess` ; `null` si rien n'est montré. */
export function projectItem(
  access: ItemAccess,
  item: ItemRecord,
  viewerId: string,
  context: ProjectionContext = {},
): ItemView | null {
  // Seconde barrière de LST-19 : un élément retiré n'a pas de vue, quelle que soit la décision.
  if (item.status === 'WITHDRAWN') return null;
  switch (access) {
    case 'none':
      return null;
    case 'recipient':
      return recipientView(item, viewerId);
    case 'giver':
      return giverView(item, viewerId, context);
  }
}
