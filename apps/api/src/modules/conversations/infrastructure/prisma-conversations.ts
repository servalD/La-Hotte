import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import type { ItemActivity } from '../../../shared/domain';
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

type CommentRow = Prisma.CommentGetPayload<object>;

/** COM-14 : forme fermée, relue champ par champ (jamais la valeur JSON telle quelle). */
function activityOf(row: CommentRow): ItemActivity | null {
  if (row.kind !== 'ACTIVITY' || !row.activityCode) return null;
  const data = (row.activityData ?? {}) as Record<string, unknown>;
  switch (row.activityCode) {
    case 'PRICE_CHANGED':
      return {
        code: 'PRICE_CHANGED',
        before: typeof data.before === 'number' ? data.before : null,
        after: typeof data.after === 'number' ? data.after : null,
        currency: typeof data.currency === 'string' ? data.currency : '',
      };
    case 'RECEIVED':
    case 'UNRECEIVED':
    case 'SHOWN':
      return { code: row.activityCode };
    default:
      return null;
  }
}

function toComment(row: CommentRow): CommentRecord {
  return {
    id: row.id,
    itemId: row.itemId,
    thread: row.thread,
    kind: row.kind,
    authorId: row.authorProfileId,
    body: row.body,
    mentionIds: row.mentionIds,
    activity: activityOf(row),
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    maskedAt: row.maskedAt,
    moderatedAt: row.moderatedAt,
    createdAt: row.createdAt,
  };
}

function activityData(activity: ItemActivity | null): Prisma.InputJsonValue | undefined {
  if (!activity) return undefined;
  if (activity.code === 'PRICE_CHANGED') {
    return { before: activity.before, after: activity.after, currency: activity.currency };
  }
  return {};
}

@Injectable()
export class PrismaCommentRepository extends CommentRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(comment: NewComment): Promise<CommentRecord> {
    const row = await this.prisma.comment.create({
      data: {
        id: comment.id,
        itemId: comment.itemId,
        thread: comment.thread,
        kind: comment.kind,
        authorProfileId: comment.authorId,
        body: comment.body,
        mentionIds: [...comment.mentionIds],
        activityCode: comment.activity?.code ?? null,
        activityData: activityData(comment.activity),
        createdAt: comment.at,
      },
    });
    return toComment(row);
  }

  async find(commentId: string): Promise<CommentRecord | null> {
    const row = await this.prisma.comment.findUnique({ where: { id: commentId } });
    return row ? toComment(row) : null;
  }

  async page(input: {
    viewerId: string;
    itemId: string;
    thread: Thread;
    before: CommentCursor | null;
    limit: number;
  }): Promise<CommentRecord[]> {
    const { before } = input;
    // DAT-05 : lu au nom du lecteur ; la base n'ouvre jamais le fil des offreurs à un destinataire.
    const rows = await this.prisma.asViewer(input.viewerId, (tx) =>
      tx.comment.findMany({
        where: {
          itemId: input.itemId,
          thread: input.thread,
          ...(before
            ? {
                OR: [
                  { createdAt: { lt: before.createdAt } },
                  { createdAt: before.createdAt, id: { lt: before.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit,
      }),
    );
    return rows.map(toComment);
  }

  async edit(input: {
    commentId: string;
    body: string;
    mentionIds: readonly string[];
    at: Date;
  }): Promise<CommentRecord | null> {
    const { count } = await this.prisma.comment.updateMany({
      where: { id: input.commentId, deletedAt: null, kind: 'MESSAGE' },
      data: { body: input.body, mentionIds: [...input.mentionIds], editedAt: input.at },
    });
    return count === 1 ? this.find(input.commentId) : null;
  }

  async softDelete(commentId: string, at: Date): Promise<CommentRecord | null> {
    const [, updated] = await this.prisma.$transaction([
      this.prisma.commentReaction.deleteMany({ where: { commentId } }),
      this.prisma.comment.updateMany({
        where: { id: commentId, deletedAt: null, kind: 'MESSAGE' },
        data: { body: '', mentionIds: [], deletedAt: at },
      }),
    ]);
    return updated.count === 1 ? this.find(commentId) : null;
  }

  async setMasked(commentId: string, at: Date | null): Promise<boolean> {
    const { count } = await this.prisma.comment.updateMany({
      where: { id: commentId, kind: 'MESSAGE', deletedAt: null, moderatedAt: null },
      data: { maskedAt: at },
    });
    return count === 1;
  }

  async setModerated(commentId: string, at: Date | null): Promise<boolean> {
    const { count } = await this.prisma.comment.updateMany({
      where: { id: commentId, kind: 'MESSAGE', deletedAt: null },
      data: { moderatedAt: at, maskedAt: null },
    });
    return count === 1;
  }

  async eraseModerated(ids: readonly string[], at: Date): Promise<number> {
    if (ids.length === 0) return 0;
    const [, erased] = await this.prisma.$transaction([
      this.prisma.commentReaction.deleteMany({ where: { commentId: { in: [...ids] } } }),
      this.prisma.comment.updateMany({
        where: { id: { in: [...ids] }, moderatedAt: { not: null }, deletedAt: null },
        data: { body: '', mentionIds: [], deletedAt: at },
      }),
    ]);
    return erased.count;
  }

  async countMessages(itemId: string): Promise<Record<Thread, number>> {
    const rows = await this.prisma.comment.groupBy({
      by: ['thread'],
      where: { itemId, kind: 'MESSAGE', deletedAt: null },
      _count: { _all: true },
    });
    const counts: Record<Thread, number> = { PUBLIC: 0, GIVERS: 0 };
    for (const row of rows) counts[row.thread] = row._count._all;
    return counts;
  }

  async react(commentId: string, profileId: string, reaction: CommentReaction): Promise<void> {
    await this.prisma.commentReaction.upsert({
      where: { commentId_profileId_reaction: { commentId, profileId, reaction } },
      create: { commentId, profileId, reaction },
      update: {},
    });
  }

  async unreact(commentId: string, profileId: string, reaction: CommentReaction): Promise<void> {
    await this.prisma.commentReaction.deleteMany({ where: { commentId, profileId, reaction } });
  }

  async reactionsOf(
    commentIds: readonly string[],
    viewerId: string,
  ): Promise<Map<string, ReactionCount[]>> {
    const result = new Map<string, ReactionCount[]>();
    if (commentIds.length === 0) return result;
    const rows = await this.prisma.commentReaction.findMany({
      where: { commentId: { in: [...commentIds] } },
      select: { commentId: true, profileId: true, reaction: true },
    });
    for (const id of commentIds) {
      const mine = rows.filter((row) => row.commentId === id);
      const counts = COMMENT_REACTIONS.flatMap((reaction) => {
        const of = mine.filter((row) => row.reaction === reaction);
        return of.length === 0
          ? []
          : [{ reaction, count: of.length, mine: of.some((row) => row.profileId === viewerId) }];
      });
      result.set(id, counts);
    }
    return result;
  }
}

@Injectable()
export class PrismaFollowRepository extends FollowRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async followByDefault(itemId: string, profileId: string): Promise<void> {
    await this.prisma.itemFollow.createMany({
      data: [{ itemId, profileId, following: true }],
      skipDuplicates: true,
    });
  }

  async set(itemId: string, profileId: string, following: boolean): Promise<void> {
    await this.prisma.itemFollow.upsert({
      where: { itemId_profileId: { itemId, profileId } },
      create: { itemId, profileId, following },
      update: { following },
    });
  }

  async isFollowing(itemId: string, profileId: string): Promise<boolean> {
    const row = await this.prisma.itemFollow.findUnique({
      where: { itemId_profileId: { itemId, profileId } },
      select: { following: true },
    });
    return row?.following ?? false;
  }

  async followersOf(itemId: string): Promise<string[]> {
    const rows = await this.prisma.itemFollow.findMany({
      where: { itemId, following: true },
      select: { profileId: true },
    });
    return rows.map((row) => row.profileId);
  }
}

@Injectable()
export class PrismaConversationPeople extends ConversationPeople {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async cards(profileIds: readonly string[]): Promise<PersonCard[]> {
    if (profileIds.length === 0) return [];
    return this.prisma.profile.findMany({
      where: { id: { in: [...profileIds] } },
      select: { id: true, displayName: true, avatar: true, accentColor: true },
    });
  }
}
