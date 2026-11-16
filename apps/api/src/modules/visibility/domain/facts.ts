// Faits dont le moteur a besoin, lus par les dépôts des autres modules et passés tels quels.
// Aucun fait n'est une décision : le moteur seul décide (ADR 0004, invariant 2).

export type ListType = 'WISHLIST' | 'GIFTLIST';
export type ListRole = 'CREATOR' | 'OWNER' | 'CONTRIBUTOR' | 'READER';
export type ListAudience = 'MEMBERS' | 'CIRCLE' | 'EVENT' | 'CUSTOM';
export type VisibilityEditRole = 'CREATOR' | 'OWNER' | 'CONTRIBUTOR';
export type GiftExistence = 'HIDDEN' | 'REVEALED';
export type GiftContent = 'NONE' | 'PARTIAL' | 'FULL';
export type VisibilityMode = 'ALL' | 'ONLY' | 'EXCEPT';
export type ItemStatus = 'OPEN' | 'RESERVED' | 'PURCHASED' | 'WITHDRAWN';
export type ItemPriority = 'WANT' | 'LOVE' | 'MUST';

export interface ListMemberFact {
  readonly profileId: string;
  readonly role: ListRole;
  /** Ancienneté : départage les responsables (LST-09) et les contributeurs (LST-04). */
  readonly since: Date;
}

export interface ListFacts {
  readonly id: string;
  readonly type: ListType;
  readonly audience: ListAudience;
  readonly recipients: readonly string[];
  readonly members: readonly ListMemberFact[];
  /** VIS-01 : sélection explicite (`CUSTOM`). */
  readonly customAudience: readonly string[];
  readonly visibilityEditRole: VisibilityEditRole;
  readonly giftExistence: GiftExistence;
  readonly giftContent: GiftContent;
  readonly personal: boolean;
  readonly archived: boolean;
  readonly deleted: boolean;
}

/** Règle d'un élément (VIS-10). */
export interface ItemRule {
  readonly mode: VisibilityMode;
  readonly profiles: readonly string[];
}

export interface ItemFacts {
  readonly id: string;
  readonly listId: string;
  readonly rule: ItemRule;
  readonly status: ItemStatus;
  readonly isSuggestion: boolean;
  readonly shownToRecipient: boolean;
  /** Absent si l'auteur a supprimé son profil (PRO-06). */
  readonly addedBy: string | null;
}

/**
 * Faits sur le demandeur relativement à la liste, calculés par le service à partir du cercle
 * (LNK-09) : vrai si le demandeur est dans le cercle d'au moins un destinataire (VIS-03).
 */
export interface ViewerContext {
  readonly profileId: string;
  readonly inRecipientsCircle: boolean;
}
