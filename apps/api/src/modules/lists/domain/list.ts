import type {
  GiftContent,
  GiftExistence,
  ItemFacts,
  ItemPriority,
  ItemRecord,
  ListAudience,
  ListEventFacts,
  ListFacts,
  ListMemberFact,
  ListType,
  VisibilityEditRole,
  VisibilityMode,
} from '../../visibility';

// Listes et éléments (03, LST-01 à LST-20, WSH, GFT). Les décisions de lecture et d'action
// appartiennent à `visibility` ; ce module tient les données et leurs invariants.

export const LIST_TITLE_MAX = 120;
export const LIST_DESCRIPTION_MAX = 1000;
export const ITEM_NOTE_MAX = 500;
export const ITEM_QUANTITY_MAX = 999;
export const LIST_RECIPIENTS_MAX = 10;
export const CUSTOM_AUDIENCE_MAX = 100;
/** WSH-02 : nom de « Mes envies ». */
export const PERSONAL_LIST_TITLE = 'Mes envies';
/** LST-20 */
export const TRASH_RETENTION_DAYS = 30;

export type WithdrawnReason = 'ALREADY_HAVE' | 'NO_LONGER_WANTED';

export interface ListRecord {
  readonly id: string;
  readonly type: ListType;
  readonly title: string;
  readonly description: string;
  readonly personalProfileId: string | null;
  /** EVT-29 : événement de rattachement, avec son audience (EVT-14) et sa clôture (EVT-38). */
  readonly event: ListEventFacts | null;
  readonly audience: ListAudience;
  readonly recipients: readonly string[];
  readonly members: readonly ListMemberFact[];
  readonly customAudience: readonly string[];
  readonly defaultItemVisibility: VisibilityMode;
  readonly visibilityEditRole: VisibilityEditRole;
  readonly giftExistence: GiftExistence;
  readonly giftContent: GiftContent;
  readonly archivedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly version: number;
}

export function factsOf(list: ListRecord): ListFacts {
  return {
    id: list.id,
    type: list.type,
    audience: list.audience,
    recipients: list.recipients,
    members: list.members,
    customAudience: list.customAudience,
    visibilityEditRole: list.visibilityEditRole,
    giftExistence: list.giftExistence,
    giftContent: list.giftContent,
    personal: list.personalProfileId !== null,
    archived: list.archivedAt !== null,
    deleted: list.deletedAt !== null,
    event: list.event,
  };
}

export function itemFactsOf(item: ItemRecord): ItemFacts {
  return {
    id: item.id,
    listId: item.listId,
    rule: { mode: item.visibilityMode, profiles: item.visibilityProfiles },
    status: item.status,
    isSuggestion: item.isSuggestion,
    shownToRecipient: item.shownToRecipient,
    addedBy: item.addedBy,
  };
}

/** VIS-02 : audience par défaut. */
export function defaultAudience(type: ListType): ListAudience {
  return type === 'WISHLIST' ? 'CIRCLE' : 'MEMBERS';
}

/** GFT-04 : un contenu montré exige l'existence révélée. */
export function giftSettingsConsistent(existence: GiftExistence, content: GiftContent): boolean {
  return content === 'NONE' || existence === 'REVEALED';
}

export function textProblem(title: string | undefined, description: string | undefined): boolean {
  if (title !== undefined && (title.trim().length === 0 || title.length > LIST_TITLE_MAX)) {
    return true;
  }
  return description !== undefined && description.length > LIST_DESCRIPTION_MAX;
}

export type ItemSort = 'position' | 'priority' | 'price' | 'added';

/** Champs modifiables d'un élément (ART-06, ART-10, ART-12, LST-06, GFT-02). */
export interface ItemChanges {
  readonly quantity?: number;
  readonly unitPriceMinor?: number | null;
  readonly currency?: string;
  readonly priority?: ItemPriority;
  readonly note?: string;
  readonly manyWelcome?: boolean;
  readonly position?: number;
  readonly intendedRecipientId?: string | null;
  readonly shownToRecipient?: boolean;
}

/**
 * VIS-35 (revue SEC-40 de la phase 4, R4) : la version d'un élément est montrée au destinataire ;
 * elle ne bouge pas quand seuls des champs qu'il ne voit pas changent (position, destinataire
 * prévu). La concurrence sur ces champs reste vérifiée par la version attendue.
 */
const UNVERSIONED_ITEM_FIELDS: ReadonlySet<keyof ItemChanges> = new Set([
  'position',
  'intendedRecipientId',
]);

export function itemChangesBumpVersion(changes: ItemChanges): boolean {
  return (Object.keys(changes) as (keyof ItemChanges)[]).some(
    (key) => changes[key] !== undefined && !UNVERSIONED_ITEM_FIELDS.has(key),
  );
}

export function itemChangesProblem(changes: ItemChanges): boolean {
  if (
    changes.quantity !== undefined &&
    (!Number.isInteger(changes.quantity) ||
      changes.quantity < 1 ||
      changes.quantity > ITEM_QUANTITY_MAX)
  ) {
    return true;
  }
  if (
    changes.unitPriceMinor !== undefined &&
    changes.unitPriceMinor !== null &&
    (!Number.isSafeInteger(changes.unitPriceMinor) || changes.unitPriceMinor < 0)
  ) {
    return true;
  }
  if (changes.currency !== undefined && !/^[A-Z]{3}$/.test(changes.currency)) return true;
  return changes.note !== undefined && changes.note.length > ITEM_NOTE_MAX;
}
