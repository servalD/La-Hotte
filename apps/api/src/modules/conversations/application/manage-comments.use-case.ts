import { Injectable } from '@nestjs/common';
import { AppEvents, Clock, IdGenerator, type ItemActivity } from '../../../shared/domain';
import { type ItemAccessContext, ItemAccessReader } from '../../lists';
import { type Thread, threadLevel, VisibilityService } from '../../visibility';
import {
  canDeleteComment,
  canEditComment,
  canReact,
  COMMENT_MENTIONS_MAX,
  COMMENT_PAGE_MAX,
  type CommentModeration,
  type CommentReaction,
  type CommentRecord,
  decodeCursor,
  encodeCursor,
  moderationSeenBy,
  normalizeBody,
  type ReactionCount,
} from '../domain/comment';
import {
  CommentActionForbiddenError,
  CommentEditExpiredError,
  CommentInvalidError,
  CommentNotFoundError,
  ThreadNotFoundError,
} from '../domain/comment.errors';
import {
  CommentRepository,
  ConversationPeople,
  FollowRepository,
  type PersonCard,
} from '../domain/conversation.ports';

/** Un message tel qu'un lecteur du fil le voit (COM-02, COM-07, COM-15, COM-16). */
export interface CommentView {
  readonly id: string;
  readonly itemId: string;
  readonly thread: Thread;
  readonly kind: 'MESSAGE' | 'ACTIVITY';
  readonly author: PersonCard | null;
  readonly body: string;
  readonly mentions: readonly PersonCard[];
  readonly activity: ItemActivity | null;
  readonly editedAt: Date | null;
  readonly deleted: boolean;
  /** MOD-08, MOD-10 : texte et mentions vides si le message est masqué pour ce lecteur ou retiré. */
  readonly moderation: CommentModeration;
  readonly createdAt: Date;
  readonly reactions: readonly ReactionCount[];
  readonly mine: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}

export interface CommentPage {
  readonly items: readonly CommentView[];
  readonly nextCursor: string | null;
}

/** Ce qu'un profil sait des fils d'un élément (COM-03, COM-12, COM-17, NOT-13). */
export type ThreadsSummary =
  | {
      readonly view: 'recipient';
      readonly public: { readonly count: number; readonly canWrite: boolean };
      readonly following: boolean;
    }
  | {
      readonly view: 'giver';
      /** COM-12 : absent si le fil Public est fermé. */
      readonly public: { readonly count: number; readonly canWrite: boolean } | null;
      readonly givers: { readonly count: number; readonly canWrite: boolean };
      readonly following: boolean;
    };

/** Accès d'un profil à un fil ; `404` comme un élément invisible (COM-11, VIS-34). */
async function threadOf(
  reader: ItemAccessReader,
  viewerId: string,
  itemId: string,
  thread: Thread,
): Promise<{ context: ItemAccessContext; canWrite: boolean }> {
  const context = await reader.forViewer(viewerId, itemId);
  const level = context ? threadLevel(context.threads, thread) : 'none';
  if (!context || level === 'none') throw new ThreadNotFoundError();
  return { context, canWrite: level === 'write' };
}

/**
 * COM-13 (revue SEC-40, B1) : les mentions sont celles que l'auteur a choisies dans son propre
 * cercle (LNK-09), montrées telles quelles, que le mentionné lise le fil ou non : ni la réponse ni
 * la relecture ne disent qui lit le fil. Seule la notification passe par le moteur (NOT-10).
 */
async function allowedMentions(
  visibility: VisibilityService,
  authorId: string,
  mentionIds: readonly string[],
): Promise<string[]> {
  const wanted = [...new Set(mentionIds)].filter((id) => id !== authorId);
  if (wanted.length === 0) return [];
  const circle = new Set(await visibility.circleOf(authorId));
  return wanted.filter((id) => circle.has(id));
}

/** Vues d'un lot de messages, cartes et réactions lues en une fois. */
@Injectable()
export class CommentViews {
  constructor(
    private readonly comments: CommentRepository,
    private readonly people: ConversationPeople,
    private readonly clock: Clock,
  ) {}

  async build(
    rows: readonly CommentRecord[],
    viewerId: string,
    canModerate: boolean,
    canWrite: boolean,
  ): Promise<CommentView[]> {
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.authorId) ids.add(row.authorId);
      for (const id of row.mentionIds) ids.add(id);
    }
    const cards = new Map((await this.people.cards([...ids])).map((card) => [card.id, card]));
    const reactions = await this.comments.reactionsOf(
      rows.map((row) => row.id),
      viewerId,
    );
    const now = this.clock.now();
    return rows.map((row) => {
      const moderation = moderationSeenBy(row, viewerId);
      const hidden = moderation !== 'NONE';
      return {
        id: row.id,
        itemId: row.itemId,
        thread: row.thread,
        kind: row.kind,
        author: row.authorId ? (cards.get(row.authorId) ?? null) : null,
        body: hidden ? '' : row.body,
        mentions: hidden
          ? []
          : row.mentionIds.flatMap((id) => {
              const card = cards.get(id);
              return card ? [card] : [];
            }),
        moderation,
        activity: row.activity,
        editedAt: row.editedAt,
        deleted: row.deletedAt !== null,
        createdAt: row.createdAt,
        reactions: reactions.get(row.id) ?? [],
        mine: row.authorId !== null && row.authorId === viewerId,
        canEdit: canWrite && canEditComment(row, viewerId, now),
        canDelete: canWrite && canDeleteComment(row, viewerId, canModerate),
      };
    });
  }
}

/** GET /items/{id}/threads */
@Injectable()
export class GetThreads {
  constructor(
    private readonly reader: ItemAccessReader,
    private readonly comments: CommentRepository,
    private readonly follows: FollowRepository,
  ) {}

  async execute(input: { viewerId: string; itemId: string }): Promise<ThreadsSummary> {
    const context = await this.reader.forViewer(input.viewerId, input.itemId);
    if (!context) throw new ThreadNotFoundError();
    const counts = await this.comments.countMessages(input.itemId);
    const following = await this.follows.isFollowing(input.itemId, input.viewerId);
    const { threads } = context;
    const pub =
      threads.public === 'none'
        ? null
        : { count: counts.PUBLIC, canWrite: threads.public === 'write' };
    if (context.view === 'recipient') {
      // COM-12 : un destinataire qui voit l'élément a toujours le fil Public.
      if (!pub) throw new ThreadNotFoundError();
      // COM-03 : ni onglet, ni compteur du fil Offreurs.
      return { view: 'recipient', public: pub, following };
    }
    return {
      view: 'giver',
      public: pub,
      givers: { count: counts.GIVERS, canWrite: threads.givers === 'write' },
      following,
    };
  }
}

/** GET /items/{id}/comments?thread= (COM-17) */
@Injectable()
export class ListComments {
  constructor(
    private readonly reader: ItemAccessReader,
    private readonly comments: CommentRepository,
    private readonly views: CommentViews,
  ) {}

  async execute(input: {
    viewerId: string;
    itemId: string;
    thread: Thread;
    cursor?: string;
    limit?: number;
  }): Promise<CommentPage> {
    const { context, canWrite } = await threadOf(
      this.reader,
      input.viewerId,
      input.itemId,
      input.thread,
    );
    const before = input.cursor ? decodeCursor(input.cursor) : null;
    if (input.cursor && !before) throw new CommentInvalidError();
    const limit = Math.min(Math.max(input.limit ?? COMMENT_PAGE_MAX, 1), COMMENT_PAGE_MAX);
    const rows = await this.comments.page({
      viewerId: input.viewerId,
      itemId: input.itemId,
      thread: input.thread,
      before,
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: await this.views.build(page, input.viewerId, context.canModerate, canWrite),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
}

/** POST /items/{id}/comments (COM-11 à COM-13, NOT-13) */
@Injectable()
export class PostComment {
  constructor(
    private readonly reader: ItemAccessReader,
    private readonly comments: CommentRepository,
    private readonly follows: FollowRepository,
    private readonly views: CommentViews,
    private readonly events: AppEvents,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly visibility: VisibilityService,
  ) {}

  async execute(input: {
    viewerId: string;
    itemId: string;
    thread: Thread;
    body: string;
    mentionIds: readonly string[];
  }): Promise<CommentView> {
    const { context, canWrite } = await threadOf(
      this.reader,
      input.viewerId,
      input.itemId,
      input.thread,
    );
    if (!canWrite) throw new CommentActionForbiddenError();
    const body = normalizeBody(input.body);
    if (body === null || input.mentionIds.length > COMMENT_MENTIONS_MAX) {
      throw new CommentInvalidError();
    }
    const mentionIds = await allowedMentions(this.visibility, input.viewerId, input.mentionIds);
    const created = await this.comments.create({
      id: this.ids.next(),
      itemId: input.itemId,
      thread: input.thread,
      kind: 'MESSAGE',
      authorId: input.viewerId,
      body,
      mentionIds,
      activity: null,
      at: this.clock.now(),
    });
    // NOT-13 : commenter fait suivre, sauf désabonnement explicite.
    await this.follows.followByDefault(input.itemId, input.viewerId);
    this.events.publish({
      type: 'comment.changed',
      itemId: input.itemId,
      thread: input.thread,
      commentId: created.id,
      change: 'created',
      kind: 'MESSAGE',
      authorId: input.viewerId,
      mentionIds,
    });
    const [view] = await this.views.build([created], input.viewerId, context.canModerate, true);
    if (!view) throw new CommentNotFoundError();
    return view;
  }
}

/** Message lu par un profil qui lit son fil ; sinon `404` (COM-11). */
export async function gatedComment(
  reader: ItemAccessReader,
  comments: CommentRepository,
  viewerId: string,
  commentId: string,
): Promise<{ comment: CommentRecord; context: ItemAccessContext; canWrite: boolean }> {
  const comment = await comments.find(commentId);
  if (!comment) throw new CommentNotFoundError();
  const context = await reader.forViewer(viewerId, comment.itemId);
  const level = context ? threadLevel(context.threads, comment.thread) : 'none';
  if (!context || level === 'none') throw new CommentNotFoundError();
  return { comment, context, canWrite: level === 'write' };
}

/** PATCH /comments/{id} (COM-15) */
@Injectable()
export class EditComment {
  constructor(
    private readonly reader: ItemAccessReader,
    private readonly comments: CommentRepository,
    private readonly views: CommentViews,
    private readonly events: AppEvents,
    private readonly clock: Clock,
    private readonly visibility: VisibilityService,
  ) {}

  async execute(input: {
    viewerId: string;
    commentId: string;
    body: string;
    mentionIds: readonly string[];
  }): Promise<CommentView> {
    const { comment, context, canWrite } = await gatedComment(
      this.reader,
      this.comments,
      input.viewerId,
      input.commentId,
    );
    const now = this.clock.now();
    if (!canWrite || comment.authorId !== input.viewerId || comment.kind !== 'MESSAGE') {
      throw new CommentActionForbiddenError();
    }
    if (!canEditComment(comment, input.viewerId, now)) throw new CommentEditExpiredError();
    const body = normalizeBody(input.body);
    if (body === null || input.mentionIds.length > COMMENT_MENTIONS_MAX) {
      throw new CommentInvalidError();
    }
    const mentionIds = await allowedMentions(this.visibility, input.viewerId, input.mentionIds);
    const edited = await this.comments.edit({
      commentId: comment.id,
      body,
      mentionIds,
      at: now,
    });
    if (!edited) throw new CommentNotFoundError();
    this.events.publish({
      type: 'comment.changed',
      itemId: comment.itemId,
      thread: comment.thread,
      commentId: comment.id,
      change: 'updated',
      kind: 'MESSAGE',
      authorId: input.viewerId,
      // NOT-12 : seules les nouvelles mentions sont notifiées.
      mentionIds: mentionIds.filter((id) => !comment.mentionIds.includes(id)),
    });
    const [view] = await this.views.build([edited], input.viewerId, context.canModerate, true);
    if (!view) throw new CommentNotFoundError();
    return view;
  }
}

/** DELETE /comments/{id} (COM-15) */
@Injectable()
export class DeleteComment {
  constructor(
    private readonly reader: ItemAccessReader,
    private readonly comments: CommentRepository,
    private readonly events: AppEvents,
    private readonly clock: Clock,
  ) {}

  async execute(input: { viewerId: string; commentId: string }): Promise<void> {
    const { comment, context, canWrite } = await gatedComment(
      this.reader,
      this.comments,
      input.viewerId,
      input.commentId,
    );
    if (!canWrite || !canDeleteComment(comment, input.viewerId, context.canModerate)) {
      throw new CommentActionForbiddenError();
    }
    await this.comments.softDelete(comment.id, this.clock.now());
    this.events.publish({
      type: 'comment.changed',
      itemId: comment.itemId,
      thread: comment.thread,
      commentId: comment.id,
      change: 'deleted',
      kind: 'MESSAGE',
      authorId: input.viewerId,
      mentionIds: [],
    });
  }
}

/** PUT/DELETE /comments/{id}/reactions/{reaction} (COM-16) */
@Injectable()
export class ReactToComment {
  constructor(
    private readonly reader: ItemAccessReader,
    private readonly comments: CommentRepository,
    private readonly events: AppEvents,
  ) {}

  async execute(input: {
    viewerId: string;
    commentId: string;
    reaction: CommentReaction;
    on: boolean;
  }): Promise<void> {
    const { comment, canWrite } = await gatedComment(
      this.reader,
      this.comments,
      input.viewerId,
      input.commentId,
    );
    if (!canWrite || !canReact(comment)) throw new CommentActionForbiddenError();
    if (input.on) await this.comments.react(comment.id, input.viewerId, input.reaction);
    else await this.comments.unreact(comment.id, input.viewerId, input.reaction);
    this.events.publish({
      type: 'comment.changed',
      itemId: comment.itemId,
      thread: comment.thread,
      commentId: comment.id,
      change: 'updated',
      kind: 'MESSAGE',
      authorId: comment.authorId,
      mentionIds: [],
    });
  }
}

/** PUT/DELETE /items/{id}/follow (NOT-13) : suivre exige de voir l'élément. */
@Injectable()
export class FollowItem {
  constructor(
    private readonly reader: ItemAccessReader,
    private readonly follows: FollowRepository,
  ) {}

  async execute(input: { viewerId: string; itemId: string; following: boolean }): Promise<void> {
    if (!(await this.reader.forViewer(input.viewerId, input.itemId))) {
      throw new ThreadNotFoundError();
    }
    await this.follows.set(input.itemId, input.viewerId, input.following);
  }
}
