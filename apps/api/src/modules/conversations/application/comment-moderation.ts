import { Injectable } from '@nestjs/common';
import { ItemAccessReader } from '../../lists';
import type { Thread } from '../../visibility';
import { CommentRepository } from '../domain/conversation.ports';
import { gatedComment } from './manage-comments.use-case';

/** Ce qu'un modérateur voit d'un message signalé (ADM-05, MOD-10) : rien d'autre. */
export interface CommentForModeration {
  readonly id: string;
  readonly thread: Thread;
  readonly body: string;
  /** Pour l'avis à l'auteur (MOD-11) ; jamais rendu au modérateur. */
  readonly authorId: string | null;
  readonly masked: boolean;
  readonly removed: boolean;
  readonly createdAt: Date;
}

/** RGPD-11 : un message de l'auteur, pour son export. */
export interface AuthoredComment {
  readonly id: string;
  readonly itemId: string;
  readonly thread: Thread;
  readonly body: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
}

/**
 * Surface de `conversations` pour la modération (module `admin`). La lisibilité d'un message pour
 * le signaleur est décidée comme pour toute lecture (COM-11) : le signalement ne devient pas un
 * moyen de tester l'existence d'un message (SEC-04).
 */
@Injectable()
export class CommentModerationGate {
  constructor(
    private readonly reader: ItemAccessReader,
    private readonly comments: CommentRepository,
  ) {}

  /** MOD-07 : message vivant que ce profil lit, ou `null` (même réponse qu'un inconnu). */
  async readable(
    viewerId: string,
    commentId: string,
  ): Promise<{ readonly authorId: string | null } | null> {
    try {
      const { comment } = await gatedComment(this.reader, this.comments, viewerId, commentId);
      if (comment.kind !== 'MESSAGE' || comment.deletedAt || comment.moderatedAt) return null;
      return { authorId: comment.authorId };
    } catch {
      return null;
    }
  }

  /**
   * RGPD-11 : messages de ce profil qu'il lit encore (COM-11) ; un message d'un fil qui lui est
   * désormais fermé (devenu destinataire, VIS-20) n'en sort pas.
   */
  async authoredReadable(profileId: string, limit: number): Promise<AuthoredComment[]> {
    const rows = await this.comments.byAuthor(profileId, limit);
    const out: AuthoredComment[] = [];
    for (const row of rows) {
      if (await this.readable(profileId, row.id)) {
        out.push({
          id: row.id,
          itemId: row.itemId,
          thread: row.thread,
          body: row.body,
          createdAt: row.createdAt,
          editedAt: row.editedAt,
        });
      }
    }
    return out;
  }

  async forModerator(commentId: string): Promise<CommentForModeration | null> {
    const row = await this.comments.find(commentId);
    if (!row || row.kind !== 'MESSAGE' || row.deletedAt) return null;
    return {
      id: row.id,
      thread: row.thread,
      body: row.body,
      authorId: row.authorId,
      masked: row.maskedAt !== null,
      removed: row.moderatedAt !== null,
      createdAt: row.createdAt,
    };
  }

  mask(commentId: string, at: Date | null): Promise<boolean> {
    return this.comments.setMasked(commentId, at);
  }

  remove(commentId: string, at: Date | null): Promise<boolean> {
    return this.comments.setModerated(commentId, at);
  }

  erase(commentIds: readonly string[], at: Date): Promise<number> {
    return this.comments.eraseModerated(commentIds, at);
  }
}
