import type { Thread } from '../../visibility';
import {
  COMMENT_REACTIONS,
  type CommentCursor,
  type CommentReaction,
  type CommentRecord,
  type ReactionCount,
} from '../domain/comment';
import {
  CommentRepository,
  ConversationPeople,
  FollowRepository,
  type NewComment,
  type PersonCard,
} from '../domain/conversation.ports';

/** Double du dépôt des messages : mêmes invariants que les `CHECK` de la migration. */
export class InMemoryCommentRepository extends CommentRepository {
  readonly comments = new Map<string, CommentRecord>();
  readonly reactions = new Set<string>();

  create(comment: NewComment): Promise<CommentRecord> {
    const record: CommentRecord = {
      id: comment.id,
      itemId: comment.itemId,
      thread: comment.thread,
      kind: comment.kind,
      authorId: comment.authorId,
      body: comment.body,
      mentionIds: [...comment.mentionIds],
      activity: comment.activity,
      editedAt: null,
      deletedAt: null,
      createdAt: comment.at,
    };
    this.comments.set(record.id, record);
    return Promise.resolve(record);
  }

  find(commentId: string): Promise<CommentRecord | null> {
    return Promise.resolve(this.comments.get(commentId) ?? null);
  }

  page(input: {
    itemId: string;
    thread: Thread;
    before: CommentCursor | null;
    limit: number;
  }): Promise<CommentRecord[]> {
    const { before } = input;
    const rows = [...this.comments.values()]
      .filter((c) => c.itemId === input.itemId && c.thread === input.thread)
      .filter(
        (c) =>
          !before ||
          c.createdAt < before.createdAt ||
          (c.createdAt.getTime() === before.createdAt.getTime() && c.id < before.id),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    return Promise.resolve(rows.slice(0, input.limit));
  }

  edit(input: {
    commentId: string;
    body: string;
    mentionIds: readonly string[];
    at: Date;
  }): Promise<CommentRecord | null> {
    const row = this.comments.get(input.commentId);
    if (!row || row.deletedAt || row.kind !== 'MESSAGE') return Promise.resolve(null);
    const next = {
      ...row,
      body: input.body,
      mentionIds: [...input.mentionIds],
      editedAt: input.at,
    };
    this.comments.set(row.id, next);
    return Promise.resolve(next);
  }

  softDelete(commentId: string, at: Date): Promise<CommentRecord | null> {
    const row = this.comments.get(commentId);
    if (!row || row.deletedAt || row.kind !== 'MESSAGE') return Promise.resolve(null);
    for (const key of [...this.reactions])
      if (key.startsWith(`${commentId}|`)) this.reactions.delete(key);
    const next = { ...row, body: '', mentionIds: [], deletedAt: at };
    this.comments.set(row.id, next);
    return Promise.resolve(next);
  }

  countMessages(itemId: string): Promise<Record<Thread, number>> {
    const counts: Record<Thread, number> = { PUBLIC: 0, GIVERS: 0 };
    for (const c of this.comments.values()) {
      if (c.itemId === itemId && c.kind === 'MESSAGE' && !c.deletedAt) counts[c.thread] += 1;
    }
    return Promise.resolve(counts);
  }

  react(commentId: string, profileId: string, reaction: CommentReaction): Promise<void> {
    this.reactions.add(`${commentId}|${profileId}|${reaction}`);
    return Promise.resolve();
  }

  unreact(commentId: string, profileId: string, reaction: CommentReaction): Promise<void> {
    this.reactions.delete(`${commentId}|${profileId}|${reaction}`);
    return Promise.resolve();
  }

  reactionsOf(
    commentIds: readonly string[],
    viewerId: string,
  ): Promise<Map<string, ReactionCount[]>> {
    const rows = [...this.reactions].map((key) => {
      const [commentId, profileId, reaction] = key.split('|');
      return { commentId, profileId, reaction };
    });
    const result = new Map<string, ReactionCount[]>();
    for (const id of commentIds) {
      result.set(
        id,
        COMMENT_REACTIONS.flatMap((reaction) => {
          const of = rows.filter((r) => r.commentId === id && r.reaction === reaction);
          return of.length === 0
            ? []
            : [{ reaction, count: of.length, mine: of.some((r) => r.profileId === viewerId) }];
        }),
      );
    }
    return Promise.resolve(result);
  }
}

export class InMemoryFollowRepository extends FollowRepository {
  readonly follows = new Map<string, boolean>();

  followByDefault(itemId: string, profileId: string): Promise<void> {
    const key = `${itemId}|${profileId}`;
    if (!this.follows.has(key)) this.follows.set(key, true);
    return Promise.resolve();
  }

  set(itemId: string, profileId: string, following: boolean): Promise<void> {
    this.follows.set(`${itemId}|${profileId}`, following);
    return Promise.resolve();
  }

  isFollowing(itemId: string, profileId: string): Promise<boolean> {
    return Promise.resolve(this.follows.get(`${itemId}|${profileId}`) ?? false);
  }

  followersOf(itemId: string): Promise<string[]> {
    return Promise.resolve(
      [...this.follows.entries()]
        .filter(([key, on]) => on && key.startsWith(`${itemId}|`))
        .map(([key]) => key.split('|')[1] ?? ''),
    );
  }
}

/** Relié par le banc de test aux profils du double d'`identity`. */
export class InMemoryConversationPeople extends ConversationPeople {
  cardOf: (profileId: string) => PersonCard | null = () => null;

  cards(profileIds: readonly string[]): Promise<PersonCard[]> {
    return Promise.resolve(
      profileIds.flatMap((id) => {
        const card = this.cardOf(id);
        return card ? [card] : [];
      }),
    );
  }
}
