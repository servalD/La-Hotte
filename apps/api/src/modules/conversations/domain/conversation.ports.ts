import type { ItemActivity } from '../../../shared/domain';
import type { Thread } from '../../visibility';
import type {
  CommentCursor,
  CommentKind,
  CommentReaction,
  CommentRecord,
  ReactionCount,
} from './comment';

export interface NewComment {
  readonly id: string;
  readonly itemId: string;
  readonly thread: Thread;
  readonly kind: CommentKind;
  readonly authorId: string | null;
  readonly body: string;
  readonly mentionIds: readonly string[];
  readonly activity: ItemActivity | null;
  readonly at: Date;
}

export abstract class CommentRepository {
  abstract create(comment: NewComment): Promise<CommentRecord>;
  abstract find(commentId: string): Promise<CommentRecord | null>;
  /**
   * COM-17 : du plus récent au plus ancien, avant `before` s'il est donné. Lu au nom de
   * `viewerId` (DAT-05) : une défense de plus derrière le moteur, qui a déjà décidé.
   */
  abstract page(input: {
    readonly viewerId: string;
    readonly itemId: string;
    readonly thread: Thread;
    readonly before: CommentCursor | null;
    readonly limit: number;
  }): Promise<CommentRecord[]>;
  /** COM-15 : `null` si le message a été supprimé entre-temps. */
  abstract edit(input: {
    readonly commentId: string;
    readonly body: string;
    readonly mentionIds: readonly string[];
    readonly at: Date;
  }): Promise<CommentRecord | null>;
  /** COM-15 : texte et mentions effacés, réactions retirées, une transaction. */
  abstract softDelete(commentId: string, at: Date): Promise<CommentRecord | null>;
  /** MOD-08 : masque ou démasque un message vivant ; faux s'il n'en est plus un. */
  abstract setMasked(commentId: string, at: Date | null): Promise<boolean>;
  /** MOD-10, MOD-11 : retire (ou rétablit) un message ; le masquage tombe. */
  abstract setModerated(commentId: string, at: Date | null): Promise<boolean>;
  /** MOD-11 : texte d'un message retiré effacé définitivement (COM-15). */
  abstract eraseModerated(ids: readonly string[], at: Date): Promise<number>;
  /** RGPD-11 : messages vivants de cet auteur, du plus récent au plus ancien. */
  abstract byAuthor(profileId: string, limit: number): Promise<CommentRecord[]>;
  /** COM-17 : messages vivants par fil. */
  abstract countMessages(itemId: string): Promise<Record<Thread, number>>;
  abstract react(commentId: string, profileId: string, reaction: CommentReaction): Promise<void>;
  abstract unreact(commentId: string, profileId: string, reaction: CommentReaction): Promise<void>;
  /** COM-16 : compte par réaction, et celles du lecteur. */
  abstract reactionsOf(
    commentIds: readonly string[],
    viewerId: string,
  ): Promise<Map<string, ReactionCount[]>>;
}

/** NOT-13 */
export abstract class FollowRepository {
  /** Suivi d'office : écrit seulement s'il n'y a pas de ligne (un désabonnement explicite reste). */
  abstract followByDefault(itemId: string, profileId: string): Promise<void>;
  abstract set(itemId: string, profileId: string, following: boolean): Promise<void>;
  abstract isFollowing(itemId: string, profileId: string): Promise<boolean>;
  /** Profils qui suivent l'élément. */
  abstract followersOf(itemId: string): Promise<string[]>;
}

/** Nom, avatar et couleur d'un profil, pour l'auteur et les mentions d'un message. */
export interface PersonCard {
  readonly id: string;
  readonly displayName: string;
  readonly avatar: string | null;
  readonly accentColor: string;
}

export abstract class ConversationPeople {
  abstract cards(profileIds: readonly string[]): Promise<PersonCard[]>;
}
