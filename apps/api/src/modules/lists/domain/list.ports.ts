import type {
  GiftContent,
  GiftExistence,
  ItemCriteria,
  ItemPriority,
  ItemRecord,
  ListAudience,
  ListCandidateCriteria,
  ListRole,
  ListType,
  VisibilityEditRole,
  VisibilityMode,
} from '../../visibility';
import type { ItemChanges, ItemSort, ListRecord, WithdrawnReason } from './list';

export interface NewList {
  readonly id: string;
  readonly type: ListType;
  readonly title: string;
  readonly description: string;
  readonly creatorProfileId: string;
  readonly creatorMemberId: string;
  readonly personal: boolean;
  readonly audience: ListAudience;
  readonly recipients: readonly { readonly id: string; readonly profileId: string }[];
  readonly customAudience: readonly { readonly id: string; readonly profileId: string }[];
  readonly giftExistence: GiftExistence;
  readonly giftContent: GiftContent;
}

export interface ListChanges {
  readonly title?: string;
  readonly description?: string;
  readonly audience?: ListAudience;
  readonly defaultItemVisibility?: VisibilityMode;
  readonly visibilityEditRole?: VisibilityEditRole;
  readonly giftExistence?: GiftExistence;
  readonly giftContent?: GiftContent;
  /** `true` archive, `false` désarchive (LST-05). */
  readonly archived?: boolean;
  /** Remplace les destinataires (LST-07). */
  readonly recipients?: readonly { readonly id: string; readonly profileId: string }[];
  /** Remplace la sélection explicite (VIS-01). */
  readonly customAudience?: readonly { readonly id: string; readonly profileId: string }[];
}

export abstract class ListRepository {
  /** WSH-06 : « Mes envies » du profil, créée si elle n'existe pas (sans erreur en concurrence). */
  abstract ensurePersonal(input: {
    readonly profileId: string;
    readonly listId: string;
    readonly memberId: string;
    readonly recipientId: string;
    readonly title: string;
  }): Promise<void>;

  abstract create(list: NewList): Promise<ListRecord>;

  /** Liste quelconque (corbeille comprise) ; `visibility` décide de ce qui en sort. */
  abstract find(listId: string): Promise<ListRecord | null>;

  /**
   * VIS-31 : listes hors corbeille où le demandeur est membre ou destinataire, dont un
   * destinataire est dans son cercle (`CIRCLE`), ou qui le choisissent (`CUSTOM`).
   */
  abstract findCandidates(criteria: ListCandidateCriteria): Promise<ListRecord[]>;

  /** LST-20 : listes à la corbeille dont le demandeur est créateur ou responsable. */
  abstract findTrash(profileId: string): Promise<ListRecord[]>;

  /** API-17 : `version` si la version lue n'est plus la bonne ; `missing` si la liste a disparu. */
  abstract update(input: {
    readonly listId: string;
    readonly expectedVersion: number;
    readonly changes: ListChanges;
    readonly now: Date;
  }): Promise<ListRecord | 'version' | 'missing'>;

  /** LST-08 : ajoute ou change le rôle d'un membre (jamais `CREATOR`). */
  abstract setMember(input: {
    readonly listId: string;
    readonly id: string;
    readonly profileId: string;
    readonly role: Exclude<ListRole, 'CREATOR'>;
  }): Promise<void>;

  /** Vrai si le membre existait. Le créateur ne se retire que par `leave`. */
  abstract removeMember(listId: string, profileId: string): Promise<boolean>;

  /**
   * LST-04 : départ d'un membre ; s'il est créateur, `successorId` (membre) devient responsable
   * et la liste n'a plus de créateur. Une transaction.
   */
  abstract leave(input: {
    readonly listId: string;
    readonly profileId: string;
    readonly successorId: string | null;
  }): Promise<void>;

  /** LST-20 */
  abstract trash(listId: string, at: Date): Promise<void>;
  abstract restore(listId: string): Promise<void>;
  /** LST-20 : purge des listes à la corbeille depuis avant `before`, avec leurs éléments. */
  abstract purgeTrash(before: Date): Promise<number>;
}

export interface NewItem {
  readonly id: string;
  readonly listId: string;
  readonly productId: string;
  readonly addedBy: string;
  readonly quantity: number;
  readonly unitPriceMinor: number | null;
  readonly currency: string;
  readonly priority: ItemPriority;
  readonly note: string;
  readonly manyWelcome: boolean;
  readonly visibilityMode: VisibilityMode;
  readonly isSuggestion: boolean;
  readonly intendedRecipientId: string | null;
  readonly shownToRecipient: boolean;
}

export abstract class ItemRepository {
  /** VIS-31 : éléments d'une liste filtrés par les critères du moteur, retirés exclus. */
  abstract listItems(listId: string, criteria: ItemCriteria, sort: ItemSort): Promise<ItemRecord[]>;
  abstract find(itemId: string): Promise<ItemRecord | null>;
  /** LST-06 : ajouté en fin de liste. */
  abstract create(item: NewItem): Promise<ItemRecord>;
  abstract update(input: {
    readonly itemId: string;
    readonly expectedVersion: number;
    readonly changes: ItemChanges;
  }): Promise<ItemRecord | 'version' | 'missing'>;
  abstract delete(itemId: string): Promise<boolean>;
  /** LST-18 : pose ou retire le reçu, sans toucher à l'état réel. */
  abstract setReceived(itemId: string, at: Date | null): Promise<ItemRecord | null>;
  /** LST-15, LST-19 */
  abstract withdraw(itemId: string, reason: WithdrawnReason): Promise<ItemRecord | null>;
}
