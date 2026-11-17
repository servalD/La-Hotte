import { type AccountingLevel, canDecideReview, canSeeAmounts } from '../../visibility';
import type { AccountingItem } from '../../lists';
import { type AccountingState, contributionOf } from '../domain/accounting-state';
import type { PersonCard } from '../domain/accounting.ports';
import type { Fraction } from '../domain/money';
import { itemCostOf } from '../domain/operations';
import type { SettlementState } from '../domain/settlement';
import { covered, type ContributionMode, remaining } from '../domain/shares';

/**
 * Vues de la compta d'un élément (CPT-59). Deux formes fermées : l'offreur ne reçoit aucun
 * montant individuel ; le participant reçoit les montants, sa part et son règlement, les options
 * et les demandes. Construites champ par champ ; un destinataire n'en reçoit aucune (VIS-20).
 */

interface Common {
  readonly accountingId: string | null;
  readonly itemId: string | null;
  readonly title: string;
  readonly currency: string;
  /** CPT-57 : coût prévu de la compta ; absent sans prix (CPT-55). */
  readonly plannedTotalMinor: number | null;
  /** CPT-58 : coût actuel de l'élément s'il diffère du coût prévu (les deux prix sont montrés). */
  readonly itemTotalMinor: number | null;
  readonly coveredMinor: number;
  readonly remainingMinor: number | null;
  readonly buyer: PersonCard | null;
  readonly purchased: boolean;
  readonly canContribute: boolean;
}

export interface GiverLine {
  readonly person: PersonCard | null;
  readonly mode: ContributionMode;
  readonly rank: number;
  readonly isBuyer: boolean;
}

export interface ParticipantLine extends GiverLine {
  readonly amountMinor: number | null;
  readonly units: number | null;
  readonly mine: boolean;
}

export interface MyContribution {
  readonly id: string;
  readonly mode: ContributionMode;
  readonly share: Fraction | null;
  readonly units: number | null;
  readonly amountMinor: number | null;
  readonly rank: number;
  readonly settlement: SettlementState;
  readonly settledMinor: number;
}

export interface ReviewLine {
  readonly id: string;
  readonly kind: 'COST' | 'OPTIONS';
  readonly author: PersonCard | null;
  readonly proposedTotalMinor: number | null;
  readonly proposedReviewEnabled: boolean | null;
  readonly proposedReceiptEnabled: boolean | null;
  /** ISO 8601 : une vue rejouée (CPT-71) sort de la base telle quelle. */
  readonly createdAt: string;
  readonly canDecide: boolean;
}

export type AccountingViewModel =
  | ({ readonly view: 'giver'; readonly participants: readonly GiverLine[] } & Common)
  | ({
      readonly view: 'participant';
      readonly participants: readonly ParticipantLine[];
      readonly mine: MyContribution | null;
      readonly isBuyer: boolean;
      readonly reviewEnabled: boolean;
      readonly receiptEnabled: boolean;
      readonly reviews: readonly ReviewLine[];
    } & Common);

/** Personnes à charger pour construire la vue. */
export function peopleOf(state: AccountingState | null): string[] {
  if (!state) return [];
  const ids = new Set<string>();
  for (const row of state.contributions) if (row.profileId) ids.add(row.profileId);
  if (state.buyerId) ids.add(state.buyerId);
  for (const review of state.reviews) if (review.authorId) ids.add(review.authorId);
  return [...ids];
}

export function buildAccountingView(input: {
  readonly level: Exclude<AccountingLevel, 'none'>;
  readonly viewerId: string;
  readonly item: AccountingItem | null;
  readonly state: AccountingState | null;
  readonly cards: readonly PersonCard[];
  readonly canContribute: boolean;
}): AccountingViewModel {
  const { state, item } = input;
  const card = (id: string | null) => (id ? (input.cards.find((c) => c.id === id) ?? null) : null);
  const cost = item ? itemCostOf(item) : null;
  const currency = state?.currency ?? cost?.currency ?? 'EUR';
  const planned = state ? state.planned : (cost?.total ?? null);
  const amounts = state?.contributions ?? [];
  const total = state?.purchase?.actual ?? planned;
  const coveredMinor = covered(amounts.map((row) => ({ ...row, share: row.share })));
  const itemTotal =
    cost && state && cost.currency === state.currency && cost.total !== state.planned
      ? cost.total
      : null;
  const common: Common = {
    accountingId: state?.id ?? null,
    itemId: item?.itemId ?? state?.itemId ?? null,
    title: item?.title ?? state?.detachedTitle ?? '',
    currency,
    plannedTotalMinor: planned,
    itemTotalMinor: itemTotal,
    coveredMinor,
    remainingMinor: remaining(
      total,
      amounts.map((row) => ({ ...row, share: row.share })),
    ),
    buyer: card(state?.buyerId ?? null),
    purchased: state?.purchase !== null && state?.purchase !== undefined,
    canContribute: input.canContribute,
  };
  const ordered = [...amounts].sort((a, b) => a.rank - b.rank);
  if (!canSeeAmounts(input.level)) {
    return {
      view: 'giver',
      ...common,
      participants: ordered.map((row) => ({
        person: card(row.profileId),
        mode: row.mode,
        rank: row.rank,
        isBuyer: row.profileId !== null && row.profileId === state?.buyerId,
      })),
    };
  }
  const mine = state ? contributionOf(state, input.viewerId) : null;
  return {
    view: 'participant',
    ...common,
    participants: ordered.map((row) => ({
      person: card(row.profileId),
      mode: row.mode,
      rank: row.rank,
      isBuyer: row.profileId !== null && row.profileId === state?.buyerId,
      amountMinor: row.amount,
      units: row.units,
      mine: row.profileId === input.viewerId,
    })),
    mine: mine
      ? {
          id: mine.id,
          mode: mine.mode,
          share: mine.share,
          units: mine.units,
          amountMinor: mine.amount,
          rank: mine.rank,
          settlement: mine.settlement,
          settledMinor: mine.settled,
        }
      : null,
    isBuyer: state?.buyerId === input.viewerId,
    reviewEnabled: state?.reviewEnabled ?? true,
    receiptEnabled: state?.receiptEnabled ?? false,
    reviews: (state?.reviews ?? []).map((review) => ({
      id: review.id,
      kind: review.kind,
      author: card(review.authorId),
      proposedTotalMinor: review.proposed.total ?? null,
      proposedReviewEnabled: review.proposed.reviewEnabled ?? null,
      proposedReceiptEnabled: review.proposed.receiptEnabled ?? null,
      createdAt: review.createdAt.toISOString(),
      canDecide: canDecideReview(input.level, input.viewerId, review.authorId),
    })),
  };
}
