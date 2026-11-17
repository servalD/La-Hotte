import type { ItemFacts, ListFacts } from './facts';
import { itemAccess, type ListAccess } from './rules';

/**
 * Décisions de compta (CPT-52, CPT-58 à CPT-61, VIS-20, VIS-36, VIS-37 ; ADR 0019). Le module
 * `accounting` charge les faits et applique ces décisions ; il n'en réécrit aucune.
 */

/** Niveau d'accès à la compta d'un élément. `buyer` comprend `participant`. */
export type AccountingLevel = 'none' | 'giver' | 'participant' | 'buyer';

/** Faits de la fiche de compta, lus par `accounting`. */
export interface AccountingFacts {
  readonly participants: readonly string[];
  readonly buyerId: string | null;
}

/** L'élément et sa liste ; `null` quand la fiche est détachée (CPT-73). */
export interface AccountingSubject {
  readonly list: ListFacts;
  readonly access: ListAccess;
  readonly item: ItemFacts;
}

function writable(list: ListFacts): boolean {
  return !list.archived && !list.deleted && !(list.event?.closed ?? false);
}

/**
 * CPT-52, CPT-59 : un destinataire de la liste n'a jamais d'accès, engagé ou non (VIS-20), ni
 * l'honoré d'une surprise (VIS-36). Sinon la participation ouvre l'accès, même à qui ne voit
 * plus l'élément (VIS-37) ou quand l'élément a disparu (CPT-73) ; à défaut, la forme offreur
 * donne la vue d'offreur.
 */
export function accountingLevel(
  subject: AccountingSubject | null,
  facts: AccountingFacts,
  viewerId: string,
): AccountingLevel {
  if (subject !== null) {
    if (subject.list.recipients.includes(viewerId)) return 'none';
    if (subject.list.event?.hiddenFrom.includes(viewerId)) return 'none';
  }
  if (facts.participants.includes(viewerId)) {
    return facts.buyerId === viewerId ? 'buyer' : 'participant';
  }
  if (subject === null) return 'none';
  return itemAccess(subject.access, subject.item, viewerId) === 'giver' ? 'giver' : 'none';
}

/** CPT-60 : participer, modifier ou retirer sa participation. */
export function canContribute(subject: AccountingSubject, viewerId: string): boolean {
  if (!writable(subject.list) || subject.item.status === 'WITHDRAWN') return false;
  if (subject.list.event?.hiddenFrom.includes(viewerId)) return false;
  return itemAccess(subject.access, subject.item, viewerId) === 'giver';
}

/** CPT-59 : montants, options, demandes de revue, justificatif. */
export function canSeeAmounts(level: AccountingLevel): boolean {
  return level === 'participant' || level === 'buyer';
}

/** CPT-59 : l'état de règlement d'une part, à son participant et à l'acheteur. */
export function canSeeSettlement(
  level: AccountingLevel,
  viewerId: string,
  ownerId: string | null,
  buyerId: string | null,
): boolean {
  return canSeeAmounts(level) && (viewerId === ownerId || viewerId === buyerId);
}

/** CPT-58 : un autre participant que l'auteur de la demande. */
export function canDecideReview(
  level: AccountingLevel,
  viewerId: string,
  authorId: string | null,
): boolean {
  return canSeeAmounts(level) && viewerId !== authorId;
}

export const BUYER_REQUEST_DELAY_MS = 48 * 60 * 60 * 1000;

/**
 * CPT-61 : l'acheteur en place décide toujours ; passé 48 heures, un organisateur de l'événement
 * qui voit l'élément en offreur, ou, hors événement (`organizers` nul), tout autre participant.
 * Le candidat ne décide jamais de sa propre demande.
 */
export function canDecideBuyerRequest(input: {
  readonly level: AccountingLevel;
  readonly viewerId: string;
  readonly candidateId: string;
  readonly buyerId: string | null;
  readonly requestedAt: Date;
  readonly now: Date;
  readonly organizers: readonly string[] | null;
  readonly seenAsGiver: boolean;
}): boolean {
  if (input.viewerId === input.candidateId) return false;
  if (input.viewerId === input.buyerId && canSeeAmounts(input.level)) return true;
  if (input.now.getTime() - input.requestedAt.getTime() < BUYER_REQUEST_DELAY_MS) return false;
  if (input.organizers !== null) {
    return input.organizers.includes(input.viewerId) && input.seenAsGiver && input.level !== 'none';
  }
  return canSeeAmounts(input.level);
}

/** VIS-16, VIS-37 : le blocage d'une exclusion ne vaut que pour un auteur non destinataire. */
export function engagementBlocksRuleChange(list: ListFacts, editorId: string): boolean {
  return !list.recipients.includes(editorId);
}
