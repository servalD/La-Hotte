import type {
  EventMembership,
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

/**
 * EVT-29 : ce que `lists` lit d'un événement pour juger d'un rattachement ou des destinataires
 * d'une giftlist. Lu en base par l'adaptateur du module (aucune dépendance au module `events`).
 * Les honorés d'une surprise ne sont lus qu'après avoir vérifié que le demandeur participe.
 */
export interface EventForLists extends EventMembership {
  readonly id: string;
  readonly title: string;
  readonly isSurprise: boolean;
}

export abstract class EventLookup {
  abstract find(eventId: string): Promise<EventForLists | null>;
  /** EVT-07 : honorés d'une surprise. */
  abstract surpriseRecipients(eventId: string): Promise<string[]>;
}

export interface NewList {
  readonly id: string;
  /** EVT-29, EVT-36 : événement de rattachement dès la création. */
  readonly eventId?: string | null;
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

/** VIS-10 : une règle, telle que le journal la garde (VIS-14). */
export interface RuleSnapshot {
  readonly mode: VisibilityMode;
  readonly profiles: readonly string[];
}

/** VIS-14 : une ligne du journal, en ajout seul (DAT-02). `itemId` absent : défaut de la liste. */
export interface RuleLogEntry {
  readonly id: string;
  readonly listId: string;
  readonly itemId: string | null;
  readonly changedBy: string;
  readonly before: RuleSnapshot;
  readonly after: RuleSnapshot;
  readonly at: Date;
}

export abstract class VisibilityLogRepository {
  /** Plus récentes d'abord. */
  abstract listFor(listId: string, limit: number): Promise<RuleLogEntry[]>;
}

/**
 * VIS-16 : profils engagés sur un élément (réservation, participation). Les engagements naissent
 * avec la compta (phase 5) ; d'ici là, l'adaptateur n'en connaît aucun.
 */
export abstract class EngagementReader {
  abstract engagedProfiles(itemId: string): Promise<string[]>;
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
    /** VIS-14 : écrit dans la même transaction que le changement de la règle par défaut. */
    readonly log?: RuleLogEntry;
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

  /** EVT-29 : rattache une liste qui ne l'est pas ; faux si elle l'est déjà (concurrence). */
  abstract attachEvent(listId: string, eventId: string): Promise<boolean>;

  /** EVT-29 : détache ; une audience `EVENT` devient `MEMBERS`. */
  abstract detachEvent(listId: string): Promise<void>;

  /** EVT-36 : wishlist rattachée dont le profil est créateur et destinataire, hors corbeille. */
  abstract findEventWishlist(eventId: string, profileId: string): Promise<string | null>;

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
  /** EVT-27 : origine d'une reprise. */
  readonly carriedFromItemId?: string | null;
}

/** EVT-22 : un élément passé, avec sa liste et l'événement de celle-ci. */
export interface CarryCandidate {
  readonly item: ItemRecord;
  readonly listId: string;
  readonly event: {
    readonly id: string;
    readonly title: string;
    readonly date: string;
    readonly timezone: string;
    readonly closed: boolean;
  };
}

/** Élément qui référence une fiche, vu du répertoire. */
export interface ItemProductReference {
  readonly productId: string;
  readonly itemId: string;
  readonly version: number;
  readonly rule: RuleSnapshot;
  readonly listRecipients: readonly string[];
  /** VIS-36 : honorés de la surprise de la liste. */
  readonly surpriseFor: readonly string[];
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
  /** VIS-10, VIS-14 : remplace la règle ; la ligne du journal (s'il y en a une) dans la même transaction. */
  abstract setRule(input: {
    readonly itemId: string;
    readonly expectedVersion: number;
    readonly rule: RuleSnapshot;
    readonly profileRowIds: readonly string[];
    readonly log: RuleLogEntry | null;
  }): Promise<ItemRecord | 'version' | 'missing'>;
  /** REP-10 : fiche de chaque élément d'une liste. */
  abstract productsOfList(listId: string): Promise<{ itemId: string; productId: string }[]>;
  /** REP-10 : l'élément référence désormais cette fiche (copie privée). */
  abstract repointProduct(itemId: string, productId: string): Promise<void>;
  /** REP-06, REP-07, REP-10 : éléments non retirés qui référencent ces fiches. */
  abstract referencesOf(productIds: readonly string[]): Promise<ItemProductReference[]>;
  /**
   * EVT-22 : éléments repris possibles pour `profileId` : sur les wishlists dont il est
   * destinataire, rattachées à un autre événement que `excludeEventId`, hors corbeille ; ni
   * suggestion, ni retirés, ni reçus, ni déjà repris. Aucun filtre ne distingue ouvert, réservé ou
   * acheté. Le moteur juge ensuite chaque élément (VIS-17), le cas d'usage la date de l'événement.
   */
  abstract carryCandidates(profileId: string, excludeEventId: string): Promise<CarryCandidate[]>;

  /**
   * EVT-27 : nouvel élément qui désigne son origine, avec la règle copiée (une transaction) ;
   * `already` si l'origine a déjà été reprise (unicité en base).
   */
  abstract carry(
    item: NewItem & {
      readonly carriedFromItemId: string;
      readonly ruleProfiles: readonly { readonly id: string; readonly profileId: string }[];
    },
  ): Promise<ItemRecord | 'already'>;

  /** LST-18 : pose ou retire le reçu, sans toucher à l'état réel. */
  abstract setReceived(itemId: string, at: Date | null): Promise<ItemRecord | null>;
  /** LST-15, LST-19 */
  abstract withdraw(itemId: string, reason: WithdrawnReason): Promise<ItemRecord | null>;
}
