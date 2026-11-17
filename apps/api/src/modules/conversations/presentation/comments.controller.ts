import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveProfile, type ActiveProfileValue, RequiresProfile } from '../../identity';
import { Idempotent } from '../../../platform/http/idempotency';
import {
  type CommentReaction,
  type CommentView as CommentModel,
  DeleteComment,
  EditComment,
  FollowItem,
  GetThreads,
  ListComments,
  PostComment,
  ReactToComment,
} from '../application/contract';
import { CommentsQueryDto, EditCommentDto, PostCommentDto, REACTIONS } from './dto/comment.dto';
import {
  CommentPageView,
  CommentView,
  ItemThreadsGiverView,
  ItemThreadsRecipientView,
  THREADS_VIEW_SCHEMA,
  type ThreadsViewDto,
} from './dto/comment.view';

const UUID_PARAM = { schema: { type: 'string', format: 'uuid' } } as const;

/** Vue champ par champ (jamais `...comment`). */
function toCommentView(comment: CommentModel): CommentView {
  const activity = comment.activity;
  return {
    id: comment.id,
    itemId: comment.itemId,
    thread: comment.thread,
    kind: comment.kind,
    author: comment.author,
    body: comment.body,
    mentions: [...comment.mentions],
    activity: activity
      ? {
          code: activity.code,
          beforeMinor: activity.code === 'PRICE_CHANGED' ? activity.before : null,
          afterMinor: activity.code === 'PRICE_CHANGED' ? activity.after : null,
          currency: activity.code === 'PRICE_CHANGED' ? activity.currency : null,
        }
      : null,
    editedAt: comment.editedAt?.toISOString() ?? null,
    deleted: comment.deleted,
    createdAt: comment.createdAt.toISOString(),
    reactions: comment.reactions.map((r) => ({
      reaction: r.reaction,
      count: r.count,
      mine: r.mine,
    })),
    mine: comment.mine,
    canEdit: comment.canEdit,
    canDelete: comment.canDelete,
  };
}

/**
 * Fils d'un élément (COM-01 à COM-17). Un fil que le profil ne lit pas répond `404` comme un
 * élément invisible (COM-11, VIS-34) ; le profil vient de la session (API-11).
 */
@ApiTags('conversations')
@ApiExtraModels(ItemThreadsGiverView, ItemThreadsRecipientView)
@RequiresProfile()
@Controller()
export class CommentsController {
  constructor(
    private readonly threads: GetThreads,
    private readonly listComments: ListComments,
    private readonly postComment: PostComment,
    private readonly editComment: EditComment,
    private readonly deleteComment: DeleteComment,
    private readonly react: ReactToComment,
    private readonly follow: FollowItem,
  ) {}

  /** COM-03, COM-12, NOT-13 */
  @Get('items/:id/threads')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ schema: THREADS_VIEW_SCHEMA })
  async getItemThreads(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ThreadsViewDto> {
    const summary = await this.threads.execute({ viewerId: profile.id, itemId: id });
    if (summary.view === 'recipient') {
      return {
        view: 'recipient',
        public: { count: summary.public.count, canWrite: summary.public.canWrite },
        following: summary.following,
      };
    }
    return {
      view: 'giver',
      public: summary.public
        ? { count: summary.public.count, canWrite: summary.public.canWrite }
        : null,
      givers: { count: summary.givers.count, canWrite: summary.givers.canWrite },
      following: summary.following,
    };
  }

  /** COM-17 */
  @Get('items/:id/comments')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: CommentPageView })
  async listItemComments(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: CommentsQueryDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<CommentPageView> {
    const page = await this.listComments.execute({
      viewerId: profile.id,
      itemId: id,
      thread: query.thread,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    });
    return { items: page.items.map(toCommentView), nextCursor: page.nextCursor };
  }

  /** COM-11 à COM-13 */
  @Post('items/:id/comments')
  @Idempotent('comment.post')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiCreatedResponse({ type: CommentView })
  async postItemComment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PostCommentDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<CommentView> {
    return toCommentView(
      await this.postComment.execute({
        viewerId: profile.id,
        itemId: id,
        thread: body.thread,
        body: body.body,
        mentionIds: body.mentionIds ?? [],
      }),
    );
  }

  /** COM-15 */
  @Patch('comments/:id')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: CommentView })
  async editOneComment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: EditCommentDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<CommentView> {
    return toCommentView(
      await this.editComment.execute({
        viewerId: profile.id,
        commentId: id,
        body: body.body,
        mentionIds: body.mentionIds ?? [],
      }),
    );
  }

  /** COM-15 : il reste « message supprimé ». */
  @Delete('comments/:id')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async deleteOneComment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.deleteComment.execute({ viewerId: profile.id, commentId: id });
  }

  /** COM-16 */
  @Put('comments/:id/reactions/:reaction')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiParam({ name: 'reaction', enum: REACTIONS, enumName: 'CommentReaction' })
  @ApiNoContentResponse()
  async addCommentReaction(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('reaction', new ParseEnumPipe(REACTIONS)) reaction: CommentReaction,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.react.execute({ viewerId: profile.id, commentId: id, reaction, on: true });
  }

  @Delete('comments/:id/reactions/:reaction')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiParam({ name: 'reaction', enum: REACTIONS, enumName: 'CommentReaction' })
  @ApiNoContentResponse()
  async removeCommentReaction(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('reaction', new ParseEnumPipe(REACTIONS)) reaction: CommentReaction,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.react.execute({ viewerId: profile.id, commentId: id, reaction, on: false });
  }

  /** NOT-13 */
  @Put('items/:id/follow')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async followOneItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.follow.execute({ viewerId: profile.id, itemId: id, following: true });
  }

  @Delete('items/:id/follow')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async unfollowOneItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.follow.execute({ viewerId: profile.id, itemId: id, following: false });
  }
}
