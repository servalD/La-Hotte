import type { ItemFacts, ListFacts } from './facts';
import { authorityOf, itemAccess, type ListAccess, listAccess } from './rules';

// Fils d'un élément (06, COM-01 à COM-04, COM-11 à COM-15 ; ADR 0018). Fonctions pures : le module
// `conversations` lit et écrit, il ne décide d'aucun accès (invariant 2).

export type Thread = 'PUBLIC' | 'GIVERS';
export type ThreadLevel = 'none' | 'read' | 'write';

export interface ThreadAccess {
  readonly public: ThreadLevel;
  readonly givers: ThreadLevel;
}

const NO_THREAD: ThreadAccess = { public: 'none', givers: 'none' };

/**
 * COM-12 : le fil Public n'existe que si au moins un destinataire de la liste voit l'élément à cet
 * instant (suggestion, élément caché à tous, giftlist cachée ou non montrée : fermé).
 */
export function publicThreadOpen(list: ListFacts, item: ItemFacts): boolean {
  return list.recipients.some(
    (recipient) =>
      itemAccess(
        listAccess(list, { profileId: recipient, inRecipientsCircle: false }),
        item,
        recipient,
      ) !== 'none',
  );
}

/** COM-11 : on écrit où on lit, sauf sur une liste archivée ou à la corbeille. */
function writable(list: ListFacts): boolean {
  return !list.archived && !list.deleted;
}

/** COM-01, COM-03, COM-04, COM-11, COM-12, VIS-20. */
export function threadAccess(
  list: ListFacts,
  access: ListAccess,
  item: ItemFacts,
  viewerId: string,
): ThreadAccess {
  const seen = itemAccess(access, item, viewerId);
  if (seen === 'none') return NO_THREAD;
  const level: ThreadLevel = writable(list) ? 'write' : 'read';
  return {
    public: publicThreadOpen(list, item) ? level : 'none',
    // VIS-20 : la forme offreur seule ouvre le fil Offreurs ; un destinataire n'en a jamais.
    givers: seen === 'giver' ? level : 'none',
  };
}

/** Niveau d'un fil donné. */
export function threadLevel(access: ThreadAccess, thread: Thread): ThreadLevel {
  return thread === 'PUBLIC' ? access.public : access.givers;
}

/**
 * COM-14 : une activité née du geste d'un destinataire va au fil Public s'il est ouvert ; née du
 * geste d'un offreur (ou d'un système sans auteur), au fil Offreurs.
 */
export function activityThread(list: ListFacts, item: ItemFacts, actorId: string | null): Thread {
  if (actorId === null || !list.recipients.includes(actorId)) return 'GIVERS';
  return publicThreadOpen(list, item) ? 'PUBLIC' : 'GIVERS';
}

/** COM-15 : l'autorité de la liste supprime un message (en plus de son auteur). */
export function canModerateComment(list: ListFacts, viewerId: string): boolean {
  return authorityOf(list) === viewerId;
}
