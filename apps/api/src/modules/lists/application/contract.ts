// Ce que la présentation peut connaître du module (QA-03).
export type { ItemView } from '../../visibility';
export {
  CUSTOM_AUDIENCE_MAX,
  ITEM_NOTE_MAX,
  ITEM_QUANTITY_MAX,
  LIST_DESCRIPTION_MAX,
  LIST_RECIPIENTS_MAX,
  LIST_TITLE_MAX,
} from '../domain/list';
export {
  CreateList,
  DeleteList,
  GetList,
  LeaveList,
  ListLists,
  ListMembers,
  type ListPermissions,
  type ListSummary,
  PurgeListTrash,
  RemoveListMember,
  RestoreList,
  SetListMember,
  UpdateList,
} from './manage-lists.use-case';
export {
  AddItem,
  CopyItemProduct,
  DeleteItem,
  GetItem,
  ListItems,
  MarkItemReceived,
  UpdateItem,
  WithdrawItem,
} from './manage-items.use-case';
export {
  GetItemRule,
  type ItemRuleState,
  ReadVisibilityLog,
  SetItemRule,
} from './manage-rules.use-case';
export type { RuleLogEntry } from '../domain/list.ports';
export { AttachListToEvent, DetachListFromEvent } from './manage-event-lists.use-case';
export { CarryOver, ListCarryCandidates, SearchEventIdeas } from './carry-over.use-case';
