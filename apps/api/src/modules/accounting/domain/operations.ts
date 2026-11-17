import {
  type AccountingState,
  contributionOf,
  type ContributionRow,
  participantsOf,
  partsOf,
  type ReviewProposal,
  type ReviewRow,
  withBuyer,
  withParts,
} from './accounting-state';
import {
  ContributionExceedsRemainingError,
  ContributionFrozenError,
  ContributionInvalidError,
  ContributionSettledError,
} from './accounting.errors';
import { type Fraction, isFraction, isMinor } from './money';
import { applyPlannedCost, plannedAmounts, setParticipation } from './shares';

/** Identifiants et heure fournis par le cas d'usage (le domaine n'en fabrique pas). */
export interface OperationContext {
  readonly now: Date;
  readonly newId: () => string;
}

/** Coût courant de l'élément (prix × quantité), dans sa devise ; `null` sans prix. */
export interface ItemCost {
  readonly total: number | null;
  readonly currency: string;
}

export function itemCostOf(item: {
  readonly unitPriceMinor: number | null;
  readonly quantity: number;
  readonly currency: string;
}): ItemCost {
  return {
    total: item.unitPriceMinor === null ? null : item.unitPriceMinor * item.quantity,
    currency: item.currency,
  };
}

/** Résultat d'une opération : l'état suivant, et les demandes sorties de l'attente. */
export interface Outcome {
  readonly state: AccountingState;
  readonly closedReviews: readonly ReviewRow[];
}

const unchanged = (state: AccountingState): Outcome => ({ state, closedReviews: [] });

function decided(
  row: ReviewRow,
  status: ReviewRow['status'],
  by: string | null,
  now: Date,
): ReviewRow {
  return { ...row, status, decidedBy: by, decidedAt: now };
}

/** CPT-57 : applique un nouveau coût prévu (pourcentages suivis, Tout qui complète, CPT-17). */
export function applyCost(state: AccountingState, total: number): AccountingState {
  const parts =
    state.planned === null
      ? plannedAmounts(total, partsOf(state))
      : applyPlannedCost(state.planned, total, partsOf(state));
  return { ...withParts(state, parts), planned: total };
}

function needsReview(state: AccountingState): boolean {
  return state.reviewEnabled && participantsOf(state).length > 1;
}

function pending(state: AccountingState, kind: ReviewRow['kind']): ReviewRow | null {
  return state.reviews.find((row) => row.kind === kind && row.status === 'PENDING') ?? null;
}

/** Ouvre une demande, en remplaçant celle du même genre encore en attente (CPT-58). */
function openReview(
  state: AccountingState,
  kind: ReviewRow['kind'],
  proposed: ReviewProposal,
  authorId: string | null,
  ctx: OperationContext,
): Outcome {
  const previous = pending(state, kind);
  const row: ReviewRow = {
    id: ctx.newId(),
    kind,
    authorId,
    proposed,
    status: 'PENDING',
    decidedBy: null,
    decidedAt: null,
    createdAt: ctx.now,
  };
  return {
    state: { ...state, reviews: [...state.reviews.filter((r) => r !== previous), row] },
    closedReviews: previous ? [decided(previous, 'REPLACED', null, ctx.now)] : [],
  };
}

/**
 * CPT-57, CPT-58 : la compta compare, à chaque passage, le coût de l'élément à son coût prévu
 * (ADR 0019). Après l'achat, ou dans une autre devise, rien ne change ; un prix retiré ne change
 * rien. Sinon le nouveau coût s'applique, ou attend la revue quand elle est cochée et qu'il y a
 * plus d'un participant. Un coût déjà refusé n'ouvre pas de nouvelle demande.
 */
export function reconcileCost(
  state: AccountingState,
  cost: ItemCost,
  ctx: OperationContext,
  authorId: string | null = null,
): Outcome {
  const refusedTotal = state.refusedCost;
  if (state.purchase || state.itemId === null) return unchanged(state);
  if (cost.currency !== state.currency || cost.total === null) return unchanged(state);
  const waiting = pending(state, 'COST');
  if (cost.total === state.planned) {
    if (!waiting) return unchanged(state);
    return {
      state: { ...state, reviews: state.reviews.filter((r) => r !== waiting) },
      closedReviews: [decided(waiting, 'CLOSED', null, ctx.now)],
    };
  }
  if (!needsReview(state)) {
    const applied = applyCost(state, cost.total);
    if (!waiting) return unchanged(applied);
    return {
      state: { ...applied, reviews: applied.reviews.filter((r) => r !== waiting) },
      closedReviews: [decided(waiting, 'CLOSED', null, ctx.now)],
    };
  }
  if (waiting?.proposed.total === cost.total || refusedTotal === cost.total)
    return unchanged(state);
  return openReview(state, 'COST', { total: cost.total }, authorId, ctx);
}

/** Saisie d'une participation (CPT-01, CPT-04, CPT-53 à CPT-56). */
export type ContributionInput =
  | { readonly mode: 'FULL' }
  | { readonly mode: 'PERCENT'; readonly share: Fraction }
  | { readonly mode: 'FIXED'; readonly amountMinor: number }
  | { readonly mode: 'UNITS'; readonly units: number };

/**
 * CPT-03, CPT-06, CPT-53 à CPT-56 : participer ou modifier sa participation avant l'achat. Le
 * rang d'arrivée est gardé à la modification (CPT-53) ; l'acheteur est le premier arrivé tant
 * qu'il participe (CPT-10).
 */
export function setContribution(
  state: AccountingState,
  profileId: string,
  input: ContributionInput,
  unitPriceMinor: number | null,
  quantity: number,
  ctx: OperationContext,
): AccountingState {
  if (state.purchase) throw new ContributionFrozenError();
  const mine = contributionOf(state, profileId);
  const rank = mine?.rank ?? state.nextRank;
  const id = mine?.id ?? ctx.newId();
  let mode: ContributionRow['mode'];
  let share: Fraction | null = null;
  let units: number | null = null;
  let amount: number | null = null;
  switch (input.mode) {
    case 'FULL':
      mode = 'FULL';
      break;
    case 'PERCENT':
      if (!isFraction(input.share)) throw new ContributionInvalidError();
      mode = 'PERCENT';
      share = input.share;
      break;
    case 'FIXED':
      if (!isMinor(input.amountMinor) || input.amountMinor === 0)
        throw new ContributionInvalidError();
      mode = 'FIXED';
      amount = input.amountMinor;
      break;
    case 'UNITS':
      // CPT-56 : n exemplaires sur la quantité, au prix unitaire ; il faut un prix.
      if (
        unitPriceMinor === null ||
        !Number.isInteger(input.units) ||
        input.units < 1 ||
        input.units > quantity
      ) {
        throw new ContributionInvalidError();
      }
      mode = 'FIXED';
      units = input.units;
      amount = unitPriceMinor * input.units;
      if (!isMinor(amount)) throw new ContributionInvalidError();
      break;
  }
  const result = setParticipation(state.planned, partsOf(state), id, {
    id,
    rank,
    mode,
    share,
    amount,
  });
  if (!('parts' in result)) {
    if (result.reason === 'EXCEEDS') throw new ContributionExceedsRemainingError(result.remaining);
    if (result.reason === 'FULL_TAKEN') throw new ContributionExceedsRemainingError(0);
    throw new ContributionInvalidError();
  }
  const row: ContributionRow = mine
    ? { ...mine, mode, share, units, amount }
    : {
        id,
        profileId,
        mode,
        share,
        units,
        amount,
        prePurchase: null,
        rank,
        settled: 0,
        settlement: 'NONE',
        settledAt: null,
        settlementNote: null,
        createdAt: ctx.now,
      };
  const contributions = mine
    ? state.contributions.map((c) => (c.id === id ? row : c))
    : [...state.contributions, row];
  const next = withParts(
    { ...state, contributions, nextRank: mine ? state.nextRank : state.nextRank + 1 },
    result.parts,
  );
  return withBuyer(next);
}

/** CPT-06, CPT-65 : retirer sa participation avant l'achat, si rien n'en est réglé. */
export function removeContribution(
  state: AccountingState,
  profileId: string,
): AccountingState | null {
  const mine = contributionOf(state, profileId);
  if (!mine) return null;
  if (state.purchase) throw new ContributionFrozenError();
  if (mine.settled > 0) throw new ContributionSettledError();
  const result = setParticipation(state.planned, partsOf(state), mine.id, null);
  if (!('parts' in result)) throw new ContributionInvalidError();
  const next = withParts(
    { ...state, contributions: state.contributions.filter((c) => c.id !== mine.id) },
    result.parts,
  );
  // CPT-58 : une demande dont l'auteur s'en va reste ; avec un seul participant, plus de revue.
  return withBuyer(next);
}

export interface AccountingOptions {
  readonly reviewEnabled: boolean;
  readonly receiptEnabled: boolean;
}

/** CPT-58 : options appliquées aussitôt, ou soumises à la revue d'un autre participant. */
export function changeOptions(
  state: AccountingState,
  actorId: string,
  options: AccountingOptions,
  ctx: OperationContext,
): Outcome {
  if (
    state.reviewEnabled === options.reviewEnabled &&
    state.receiptEnabled === options.receiptEnabled
  ) {
    return unchanged(state);
  }
  if (!needsReview(state)) return unchanged({ ...state, ...options });
  return openReview(state, 'OPTIONS', { ...options }, actorId, ctx);
}

/**
 * CPT-58 : décision sur une demande en attente. Approuver un coût l'applique ; approuver des
 * options les pose. Refuser garde l'état. La demande quitte l'attente dans les deux cas.
 */
export function decideReview(
  state: AccountingState,
  reviewId: string,
  actorId: string,
  approve: boolean,
  ctx: OperationContext,
): Outcome | null {
  const review = state.reviews.find((row) => row.id === reviewId && row.status === 'PENDING');
  if (!review) return null;
  const rest = { ...state, reviews: state.reviews.filter((row) => row !== review) };
  const closed = decided(review, approve ? 'APPROVED' : 'REFUSED', actorId, ctx.now);
  if (!approve) {
    const refusedCost = review.kind === 'COST' ? (review.proposed.total ?? null) : rest.refusedCost;
    return { state: { ...rest, refusedCost }, closedReviews: [closed] };
  }
  if (review.kind === 'COST' && review.proposed.total !== undefined) {
    return { state: applyCost(rest, review.proposed.total), closedReviews: [closed] };
  }
  return {
    state: {
      ...rest,
      reviewEnabled: review.proposed.reviewEnabled ?? rest.reviewEnabled,
      receiptEnabled: review.proposed.receiptEnabled ?? rest.receiptEnabled,
    },
    closedReviews: [closed],
  };
}
