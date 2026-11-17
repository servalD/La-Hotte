import { DomainError } from '../../../shared/domain';
import {
  type AccountingState,
  type BuyerRequestRow,
  contributionOf,
  type ContributionRow,
  participantsOf,
  partsOf,
  withParts,
} from './accounting-state';
import {
  AccountingActionForbiddenError,
  ContributionFrozenError,
  ContributionInvalidError,
} from './accounting.errors';
import { isMinor } from './money';
import type { OperationContext, Outcome } from './operations';
import { settlementState } from './settlement';
import { applyGap, covered, lowerRaise, resolveUnknownFull } from './shares';

/** CPT-14, CPT-63 : décocher est libre pendant 24 heures. */
export const UNCHECK_FREE_MS = 24 * 60 * 60 * 1000;
/** CPT-18 : fenêtre de refus d'une hausse. */
export const RAISE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** CPT-63 : passé 24 heures, décocher exige une confirmation explicite. */
export class PurchaseUncheckConfirmRequiredError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'PURCHASE_UNCHECK_CONFIRM';
  constructor() {
    super('Unchecking the purchase requires confirmation.');
  }
}

/** CPT-12, CPT-62 : geste qui exige un achat coché (justificatif, refus d'une hausse). */
export class PurchaseRequiredError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'PURCHASE_REQUIRED';
  constructor() {
    super('A purchase is required.');
  }
}

/** CPT-58, CPT-62 : l'option justificatif n'est pas cochée. */
export class ReceiptDisabledError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'RECEIPT_DISABLED';
  constructor() {
    super('Receipts are disabled for this item.');
  }
}

/** CPT-20 à CPT-22, CPT-65 : état de règlement recalculé après un changement de montant. */
export function withSettlements(state: AccountingState): AccountingState {
  const purchased = state.purchase !== null;
  return {
    ...state,
    contributions: state.contributions.map((row) => ({
      ...row,
      settlement: settlementState({
        isBuyer: row.profileId !== null && row.profileId === state.buyerId,
        purchased,
        amount: row.amount ?? 0,
        settled: row.settled,
        claimed: row.settlement === 'CLAIMED',
      }),
    })),
  };
}

function closePendingCost(state: AccountingState, now: Date): Outcome {
  const waiting = state.reviews.filter((row) => row.kind === 'COST');
  return {
    state: { ...state, reviews: state.reviews.filter((row) => row.kind !== 'COST') },
    closedReviews: waiting.map((row) => ({ ...row, status: 'CLOSED', decidedAt: now })),
  };
}

/**
 * CPT-12, CPT-13, CPT-16, CPT-17, CPT-55 : l'acheteur coche Acheté, avec le prix payé s'il diffère.
 * Les parts d'avant l'achat sont gardées (`prePurchase`, plancher de CPT-18) ; l'écart est réparti ;
 * la demande de coût en attente est close (le prix payé tranche, CPT-58). Saisir de nouveau le
 * prix payé repart des parts d'avant l'achat ; la fenêtre de refus garde sa date.
 */
export function markPurchased(
  state: AccountingState,
  buyerId: string,
  actual: number | null,
  ctx: OperationContext,
): Outcome {
  if (state.buyerId !== buyerId) throw new AccountingActionForbiddenError();
  if (state.contributions.length === 0) throw new ContributionInvalidError();
  if (actual !== null && !isMinor(actual)) throw new ContributionInvalidError();
  // CPT-55 : sans prix, le prix payé est obligatoire.
  if (state.planned === null && actual === null) throw new ContributionInvalidError();
  const base: AccountingState = state.purchase
    ? {
        ...state,
        contributions: state.contributions.map((row) => ({
          ...row,
          amount: row.prePurchase ?? row.amount,
        })),
      }
    : state;
  const frozen = base.contributions.map((row) => ({ ...row, prePurchase: row.amount }));
  const withFrozen: AccountingState = { ...base, contributions: frozen };
  let parts = partsOf(withFrozen);
  if (base.planned === null && actual !== null) parts = resolveUnknownFull(actual, parts);
  else if (base.planned !== null && actual !== null && actual !== base.planned) {
    parts = applyGap(base.planned, actual, parts);
  }
  const priced = withParts(withFrozen, parts);
  const purchased: AccountingState = {
    ...priced,
    contributions: priced.contributions.map((row) => ({
      ...row,
      prePurchase: row.prePurchase ?? row.amount,
    })),
    purchase: {
      id: state.purchase?.id ?? ctx.newId(),
      buyerId,
      purchasedAt: state.purchase?.purchasedAt ?? ctx.now,
      planned: base.planned,
      actual,
      receiptKey: state.purchase?.receiptKey ?? null,
      raiseUntil: state.purchase?.raiseUntil ?? new Date(ctx.now.getTime() + RAISE_WINDOW_MS),
    },
  };
  return closePendingCost(withSettlements(purchased), ctx.now);
}

/**
 * CPT-14, CPT-63 : décocher rend les parts d'avant l'achat ; passé 24 heures, il faut confirmer.
 * Les parts à régler ou à confirmer n'ont plus rien à régler ; les parts réglées le restent.
 */
export function uncheckPurchase(
  state: AccountingState,
  buyerId: string,
  confirm: boolean,
  now: Date,
): AccountingState {
  if (!state.purchase) throw new PurchaseRequiredError();
  if (state.buyerId !== buyerId) throw new AccountingActionForbiddenError();
  if (!confirm && now.getTime() - state.purchase.purchasedAt.getTime() > UNCHECK_FREE_MS) {
    throw new PurchaseUncheckConfirmRequiredError();
  }
  const restored = state.contributions.map((row): ContributionRow => ({
    ...row,
    amount: row.prePurchase ?? row.amount,
    prePurchase: null,
  }));
  return withSettlements({ ...state, contributions: restored, purchase: null });
}

/** CPT-18 : ramener sa part augmentée, dans la fenêtre ; la différence devient un reste. */
export function lowerMyRaise(
  state: AccountingState,
  profileId: string,
  target: number,
  now: Date,
): AccountingState {
  if (!state.purchase) throw new PurchaseRequiredError();
  const mine = contributionOf(state, profileId);
  if (!mine) throw new AccountingActionForbiddenError();
  const result = lowerRaise({
    amount: mine.amount ?? 0,
    prePurchase: mine.prePurchase,
    target,
    now,
    raiseUntil: state.purchase.raiseUntil,
  });
  if (typeof result === 'string') {
    if (result === 'WINDOW_CLOSED') throw new ContributionFrozenError();
    throw new ContributionInvalidError();
  }
  return withSettlements({
    ...state,
    contributions: state.contributions.map((row) =>
      row.id === mine.id ? { ...row, amount: result.amount } : row,
    ),
  });
}

/** Reste à couvrir de l'état courant (après achat : sur le prix payé, sinon sur le coût prévu). */
export function shortfallOf(state: AccountingState): number {
  const total = state.purchase ? (state.purchase.actual ?? state.purchase.planned) : state.planned;
  if (total === null) return 0;
  return Math.max(0, total - covered(partsOf(state)));
}

/** CPT-62 : l'acheteur joint ou remplace le justificatif, si l'option est cochée. */
export function attachReceipt(
  state: AccountingState,
  buyerId: string,
  key: string,
): AccountingState {
  if (!state.purchase) throw new PurchaseRequiredError();
  if (state.buyerId !== buyerId) throw new AccountingActionForbiddenError();
  if (!state.receiptEnabled) throw new ReceiptDisabledError();
  return { ...state, purchase: { ...state.purchase, receiptKey: key } };
}

/** CPT-61 : un participant se propose ; une demande en attente par élément. */
export function requestBuyer(
  state: AccountingState,
  candidateId: string,
  ctx: OperationContext,
): AccountingState {
  if (state.purchase) throw new ContributionFrozenError();
  if (!participantsOf(state).includes(candidateId) || state.buyerId === candidateId) {
    throw new AccountingActionForbiddenError();
  }
  if (state.buyerRequest) throw new ContributionFrozenError();
  return {
    ...state,
    buyerRequest: {
      id: ctx.newId(),
      candidateId,
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
      createdAt: ctx.now,
    },
  };
}

/**
 * CPT-61 : accepter fait du candidat l'acheteur (s'il participe encore, avant l'achat) ; refuser
 * ou annuler garde l'acheteur. La décision elle-même est autorisée par le moteur.
 */
export function decideBuyerRequest(
  state: AccountingState,
  requestId: string,
  deciderId: string,
  decision: 'ACCEPTED' | 'REFUSED' | 'CANCELLED',
  now: Date,
): { readonly state: AccountingState; readonly closed: BuyerRequestRow } | null {
  const request = state.buyerRequest;
  if (request?.id !== requestId) return null;
  const closed: BuyerRequestRow = {
    ...request,
    status: decision,
    decidedBy: deciderId,
    decidedAt: now,
  };
  const cleared: AccountingState = { ...state, buyerRequest: null };
  if (decision !== 'ACCEPTED') return { state: cleared, closed };
  if (state.purchase) throw new ContributionFrozenError();
  if (!participantsOf(state).includes(request.candidateId)) throw new ContributionInvalidError();
  return { state: withSettlements({ ...cleared, buyerId: request.candidateId }), closed };
}

/**
 * CPT-64 : au lendemain de l'événement, le reste à couvrir est ajouté à la part de l'acheteur.
 * Sans reste, ou sans part de l'acheteur, rien ne change.
 */
export function absorbShortfall(state: AccountingState): AccountingState {
  const amount = shortfallOf(state);
  if (!state.purchase || amount <= 0 || state.buyerId === null) return state;
  const buyer = contributionOf(state, state.buyerId);
  if (!buyer) return state;
  return withSettlements({
    ...state,
    contributions: state.contributions.map((row) =>
      row.id === buyer.id ? { ...row, amount: (row.amount ?? 0) + amount } : row,
    ),
  });
}
