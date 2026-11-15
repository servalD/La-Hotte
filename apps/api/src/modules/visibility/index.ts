// Seule surface importable par les autres modules (QA-03). Toute lecture de liste, d'élément ou de
// fiche partagée passe par ici (VIS-30, invariant 2) : aucun autre module ne réécrit une règle.
export { VisibilityModule } from './visibility.module';
export { type ListCandidateCriteria, VisibilityService } from './application/visibility.service';
export type {
  GiftContent,
  GiftExistence,
  ItemFacts,
  ItemPriority,
  ItemRule,
  ItemStatus,
  ListAudience,
  ListFacts,
  ListMemberFact,
  ListRole,
  ListType,
  VisibilityEditRole,
  VisibilityMode,
} from './domain/facts';
export {
  type AddRight,
  addRight,
  authorityOf,
  canActAsRecipient,
  canArchiveList,
  canDeleteList,
  canEditItem,
  canEditItemRule,
  canEditList,
  canEditListRules,
  canManageMembers,
  canReadVisibilityLog,
  canRestoreList,
  type ItemAccess,
  itemAccess,
  type ItemCriteria,
  itemCriteria,
  type ListAccess,
  type ProductReference,
  requiresHiddenItemChoice,
  ruleExcludes,
  sharedProductVisible,
} from './domain/rules';
export {
  type GiverItemStatus,
  type ItemGiverView,
  type ItemProductRecord,
  type ItemRecipientView,
  type ItemRecord,
  type ItemView,
  type ProductPart,
  projectItem,
} from './domain/projection';
