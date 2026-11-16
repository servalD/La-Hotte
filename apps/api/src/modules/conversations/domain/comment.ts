import type { ItemActivity } from '../../../shared/domain';
import type { Thread } from '../../visibility';

// Fils d'un élément (06, COM-01 à COM-17). Les décisions d'accès appartiennent à `visibility`
// (invariant 2) ; ce module tient les messages et leurs invariants.

/** COM-13 */
export const COMMENT_BODY_MAX = 2000;
export const COMMENT_MENTIONS_MAX = 10;
/** COM-15 */
export const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;
/** COM-17, API-15 */
export const COMMENT_PAGE_MAX = 50;

/** COM-16 : liste fermée. */
export const COMMENT_REACTIONS = ['THUMBS_UP', 'HEART', 'LAUGH', 'WOW', 'PARTY', 'THANKS'] as const;
export type CommentReaction = (typeof COMMENT_REACTIONS)[number];

export type CommentKind = 'MESSAGE' | 'ACTIVITY';

export interface CommentRecord {
  readonly id: string;
  readonly itemId: string;
  readonly thread: Thread;
  readonly kind: CommentKind;
  readonly authorId: string | null;
  readonly body: string;
  readonly mentionIds: readonly string[];
  readonly activity: ItemActivity | null;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
}

export interface ReactionCount {
  readonly reaction: CommentReaction;
  readonly count: number;
  readonly mine: boolean;
}

/** COM-13 : texte rogné, de 1 à 2 000 caractères ; `null` s'il n'est pas valable. */
export function normalizeBody(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > COMMENT_BODY_MAX) return null;
  return trimmed;
}

/** COM-15 : l'auteur modifie un message vivant pendant 15 minutes. */
export function canEditComment(comment: CommentRecord, viewerId: string, now: Date): boolean {
  return (
    comment.kind === 'MESSAGE' &&
    comment.deletedAt === null &&
    comment.authorId === viewerId &&
    now.getTime() - comment.createdAt.getTime() <= COMMENT_EDIT_WINDOW_MS
  );
}

/** COM-15 : l'auteur, ou l'autorité de la liste ; jamais une activité. */
export function canDeleteComment(
  comment: CommentRecord,
  viewerId: string,
  isListAuthority: boolean,
): boolean {
  if (comment.kind !== 'MESSAGE' || comment.deletedAt !== null) return false;
  return comment.authorId === viewerId || isListAuthority;
}

/** COM-16 : pas de réaction sur une activité ni sur un message supprimé. */
export function canReact(comment: CommentRecord): boolean {
  return comment.kind === 'MESSAGE' && comment.deletedAt === null;
}

/** Curseur opaque d'une page (API-15) : date et identifiant du dernier message rendu. */
export interface CommentCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export function encodeCursor(cursor: CommentCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(value: string): CommentCursor | null {
  const raw = Buffer.from(value, 'base64url').toString('utf8');
  const [at, id] = raw.split('|');
  if (!at || !id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const createdAt = new Date(at);
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
}
