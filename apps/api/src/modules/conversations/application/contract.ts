// Ce que la présentation peut importer de la couche application.
export {
  type CommentPage,
  type CommentView,
  DeleteComment,
  EditComment,
  FollowItem,
  GetThreads,
  ListComments,
  PostComment,
  ReactToComment,
  type ThreadsSummary,
} from './manage-comments.use-case';
export { RecordItemActivity } from './record-item-activity.use-case';
export { COMMENT_REACTIONS, type CommentReaction } from '../domain/comment';
