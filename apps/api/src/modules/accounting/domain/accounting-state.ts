import type { LedgerKind, Snapshot } from './ledger';
import type { Fraction } from './money';
import type { SettlementState } from './settlement';
import type { ContributionMode, Part } from './shares';

/**
 * État d'une fiche de compta (ADR 0019) tel que le dépôt le lit sous verrou. Un cas d'usage
 * calcule l'état suivant ; le dépôt écrit la différence, et une écriture au journal par ligne
 * touchée, dérivée de cette même différence (CPT-70) : journal et projection ne peuvent diverger.
 */

export interface ContributionRow {
  readonly id: string;
  readonly profileId: string | null;
  readonly mode: ContributionMode;
  readonly share: Fraction | null;
  readonly units: number | null;
  readonly amount: number | null;
  readonly prePurchase: number | null;
  readonly rank: number;
  readonly settled: number;
  readonly settlement: SettlementState;
  readonly settledAt: Date | null;
  readonly settlementNote: string | null;
  /** CPT-23 : dernière relance à la main. */
  readonly nudgedAt: Date | null;
  readonly createdAt: Date;
}

export interface PurchaseRow {
  readonly id: string;
  readonly buyerId: string | null;
  readonly purchasedAt: Date;
  readonly planned: number | null;
  readonly actual: number | null;
  readonly receiptKey: string | null;
  readonly raiseUntil: Date;
}

export type ReviewKind = 'COST' | 'OPTIONS';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REFUSED' | 'REPLACED' | 'CLOSED';

export interface ReviewProposal {
  /** `COST` : nouveau coût prévu (CPT-57). */
  readonly total?: number;
  /** `OPTIONS` (CPT-58). */
  readonly reviewEnabled?: boolean;
  readonly receiptEnabled?: boolean;
}

export interface ReviewRow {
  readonly id: string;
  readonly kind: ReviewKind;
  readonly authorId: string | null;
  readonly proposed: ReviewProposal;
  readonly status: ReviewStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
}

/** CPT-61 : demande de changement d'acheteur. */
export type BuyerRequestStatus = 'PENDING' | 'ACCEPTED' | 'REFUSED' | 'CANCELLED';

export interface BuyerRequestRow {
  readonly id: string;
  readonly candidateId: string;
  readonly status: BuyerRequestStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
}

export interface AccountingState {
  readonly id: string;
  readonly itemId: string | null;
  readonly currency: string;
  readonly planned: number | null;
  readonly buyerId: string | null;
  readonly reviewEnabled: boolean;
  readonly receiptEnabled: boolean;
  readonly nextRank: number;
  readonly detachedTitle: string | null;
  readonly detachedEventId: string | null;
  readonly detachedAt: Date | null;
  readonly version: number;
  readonly contributions: readonly ContributionRow[];
  readonly purchase: PurchaseRow | null;
  /** Demandes de revue en attente seulement (les décidées ne sont lues que par le journal). */
  readonly reviews: readonly ReviewRow[];
  /** CPT-58 : dernier coût refusé en revue ; il n'ouvre pas de nouvelle demande. Lu, jamais écrit. */
  readonly refusedCost: number | null;
  /** CPT-61 : demande de changement d'acheteur en attente. */
  readonly buyerRequest: BuyerRequestRow | null;
}

/** Ouverture d'une fiche à la première participation (CPT-57 : coût prévu relevé). */
export function openAccounting(input: {
  readonly id: string;
  readonly itemId: string;
  readonly currency: string;
  readonly planned: number | null;
}): AccountingState {
  return {
    id: input.id,
    itemId: input.itemId,
    currency: input.currency,
    planned: input.planned,
    buyerId: null,
    reviewEnabled: true,
    receiptEnabled: false,
    nextRank: 1,
    detachedTitle: null,
    detachedEventId: null,
    detachedAt: null,
    version: 0,
    contributions: [],
    purchase: null,
    reviews: [],
    refusedCost: null,
    buyerRequest: null,
  };
}

export function partsOf(state: AccountingState): Part[] {
  return state.contributions.map((row) => ({
    id: row.id,
    rank: row.rank,
    mode: row.mode,
    share: row.share,
    amount: row.amount,
  }));
}

/** Reporte sur les lignes les montants (et modes, CPT-57) calculés par le domaine des parts. */
export function withParts(state: AccountingState, parts: readonly Part[]): AccountingState {
  const byId = new Map(parts.map((part) => [part.id, part]));
  return {
    ...state,
    contributions: state.contributions.map((row) => {
      const part = byId.get(row.id);
      return part ? { ...row, mode: part.mode, share: part.share, amount: part.amount } : row;
    }),
  };
}

export function participantsOf(state: AccountingState): string[] {
  return [...state.contributions]
    .sort((a, b) => a.rank - b.rank)
    .flatMap((row) => (row.profileId ? [row.profileId] : []));
}

export function contributionOf(state: AccountingState, profileId: string): ContributionRow | null {
  return state.contributions.find((row) => row.profileId === profileId) ?? null;
}

/** CPT-10, CPT-61 : l'acheteur reste s'il participe encore ; sinon le premier arrivé. */
export function withBuyer(state: AccountingState): AccountingState {
  const participants = participantsOf(state);
  if (state.buyerId !== null && participants.includes(state.buyerId)) return state;
  return { ...state, buyerId: participants[0] ?? null };
}

/** LST-11, LST-12 : état réel de l'élément, dérivé de la compta. */
export function itemStatusOf(state: AccountingState): 'OPEN' | 'RESERVED' | 'PURCHASED' {
  if (state.purchase) return 'PURCHASED';
  return state.contributions.length > 0 ? 'RESERVED' : 'OPEN';
}

// --- Différence et journal (CPT-70) ---

type Row = Readonly<Record<string, unknown>>;

function snapshot(row: Row): Snapshot {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) {
    const value = row[key];
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

function header(state: AccountingState): Row {
  const {
    contributions: _c,
    purchase: _p,
    reviews: _r,
    version: _v,
    refusedCost: _f,
    buyerRequest: _b,
    ...rest
  } = state;
  return rest;
}

export interface LedgerDraft {
  readonly kind: LedgerKind;
  readonly targetId: string;
  readonly before: Snapshot | null;
  readonly after: Snapshot | null;
}

export interface AccountingDiff {
  readonly header: boolean;
  readonly contributions: { readonly upsert: ContributionRow[]; readonly remove: string[] };
  readonly purchase: { readonly upsert: PurchaseRow | null; readonly remove: string | null };
  readonly reviews: { readonly upsert: ReviewRow[] };
  readonly buyerRequests: { readonly upsert: BuyerRequestRow[] };
  readonly ledger: LedgerDraft[];
}

const same = (a: Snapshot | null, b: Snapshot | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Différence entre deux états d'une fiche. `kinds` nomme les écritures : une par genre de ligne
 * (fiche, participation, achat, demande), selon l'opération. Une demande qui quitte l'attente
 * est écrite avec son état final ; elle ne disparaît jamais du journal.
 */
export function diffAccounting(
  prev: AccountingState | null,
  next: AccountingState,
  kinds: {
    readonly header: LedgerKind;
    readonly contribution: (row: ContributionRow) => LedgerKind;
    readonly removed?: LedgerKind;
    readonly purchase?: LedgerKind;
    readonly review?: LedgerKind;
  },
  closedReviews: readonly ReviewRow[] = [],
  closedBuyerRequest: BuyerRequestRow | null = null,
): AccountingDiff {
  const ledger: LedgerDraft[] = [];
  const headerBefore = prev ? snapshot(header(prev)) : null;
  const headerAfter = snapshot(header(next));
  const headerChanged = !same(headerBefore, headerAfter);
  if (headerChanged) {
    ledger.push({
      kind: prev ? kinds.header : 'ACCOUNTING_OPENED',
      targetId: next.id,
      before: headerBefore,
      after: headerAfter,
    });
  }
  const previous = new Map((prev?.contributions ?? []).map((row) => [row.id, row]));
  const upsert: ContributionRow[] = [];
  for (const row of next.contributions) {
    const before = previous.get(row.id);
    const a = before ? snapshot(before as unknown as Row) : null;
    const b = snapshot(row as unknown as Row);
    if (!same(a, b)) {
      upsert.push(row);
      ledger.push({ kind: kinds.contribution(row), targetId: row.id, before: a, after: b });
    }
    previous.delete(row.id);
  }
  const remove = [...previous.keys()];
  for (const [id, row] of previous) {
    ledger.push({
      kind: kinds.removed ?? 'CONTRIBUTION_REMOVED',
      targetId: id,
      before: snapshot(row as unknown as Row),
      after: null,
    });
  }
  let purchaseUpsert: PurchaseRow | null = null;
  let purchaseRemove: string | null = null;
  const pBefore = prev?.purchase ? snapshot(prev.purchase as unknown as Row) : null;
  const pAfter = next.purchase ? snapshot(next.purchase as unknown as Row) : null;
  if (!same(pBefore, pAfter)) {
    if (next.purchase) purchaseUpsert = next.purchase;
    else if (prev?.purchase) purchaseRemove = prev.purchase.id;
    ledger.push({
      kind: kinds.purchase ?? (next.purchase ? 'PURCHASE_SET' : 'PURCHASE_REMOVED'),
      targetId: (next.purchase ?? prev?.purchase)?.id ?? next.id,
      before: pBefore,
      after: pAfter,
    });
  }
  const pendingBefore = new Map((prev?.reviews ?? []).map((row) => [row.id, row]));
  const reviewUpsert: ReviewRow[] = [];
  for (const row of [...next.reviews, ...closedReviews]) {
    const before = pendingBefore.get(row.id);
    const a = before ? snapshot(before as unknown as Row) : null;
    const b = snapshot(row as unknown as Row);
    if (!same(a, b)) {
      reviewUpsert.push(row);
      ledger.push({ kind: kinds.review ?? 'REVIEW_OPENED', targetId: row.id, before: a, after: b });
    }
  }
  const requestUpsert: BuyerRequestRow[] = [];
  const requests = [next.buyerRequest, closedBuyerRequest].filter(
    (row): row is BuyerRequestRow => row !== null,
  );
  for (const row of requests) {
    const before = prev?.buyerRequest?.id === row.id ? prev.buyerRequest : null;
    const a = before ? snapshot(before as unknown as Row) : null;
    const b = snapshot(row as unknown as Row);
    if (!same(a, b)) {
      requestUpsert.push(row);
      ledger.push({
        kind: row.status === 'PENDING' ? 'BUYER_REQUEST_OPENED' : 'BUYER_REQUEST_DECIDED',
        targetId: row.id,
        before: a,
        after: b,
      });
    }
  }
  return {
    header: headerChanged,
    contributions: { upsert, remove },
    purchase: { upsert: purchaseUpsert, remove: purchaseRemove },
    reviews: { upsert: reviewUpsert },
    buyerRequests: { upsert: requestUpsert },
    ledger,
  };
}
