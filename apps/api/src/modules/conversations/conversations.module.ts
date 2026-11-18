import { Module } from '@nestjs/common';
import { CommentModerationGate } from './application/comment-moderation';
import { ListsModule } from '../lists';
import { VisibilityModule } from '../visibility';
import {
  CommentViews,
  DeleteComment,
  EditComment,
  FollowItem,
  GetThreads,
  ListComments,
  PostComment,
  ReactToComment,
} from './application/manage-comments.use-case';
import { RecordItemActivity } from './application/record-item-activity.use-case';
import {
  CommentRepository,
  ConversationPeople,
  FollowRepository,
} from './domain/conversation.ports';
import {
  PrismaCommentRepository,
  PrismaConversationPeople,
  PrismaFollowRepository,
} from './infrastructure/prisma-conversations';
import { CommentsController } from './presentation/comments.controller';
import { ItemActivitySubscriber } from './presentation/item-activity.subscriber';

/** Module `conversations` : fils, messages, activité, réactions, suivi (06). Accès par `visibility`. */
@Module({
  imports: [ListsModule, VisibilityModule],
  controllers: [CommentsController],
  providers: [
    CommentModerationGate,
    CommentViews,
    GetThreads,
    ListComments,
    PostComment,
    EditComment,
    DeleteComment,
    ReactToComment,
    FollowItem,
    RecordItemActivity,
    ItemActivitySubscriber,
    { provide: CommentRepository, useClass: PrismaCommentRepository },
    { provide: FollowRepository, useClass: PrismaFollowRepository },
    { provide: ConversationPeople, useClass: PrismaConversationPeople },
  ],
  exports: [FollowRepository, CommentRepository, CommentModerationGate],
})
export class ConversationsModule {}
