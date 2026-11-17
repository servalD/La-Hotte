import { DomainError } from '../../../shared/domain';
import type { AccountingState, ContributionRow } from './accounting-state';
import { AccountingActionForbiddenError, AccountingNotFoundError } from './accounting.errors';
import { withSettlements } from './purchase';

/** CPT-23, CPT-66 : une relance à la main par 48 heures et par part. */
export const NUDGE_INTERVAL_MS = 48 * 60 * 60 * 1000;
/** CPT-24, CPT-65 */
export const SETTLEMENT_NOTE_MAX = 60;

export class NudgeTooSoonError extends DomainError {
  readonly kind = 'rate_limited';
  readonly code = 'NUDGE_TOO_SOON';
  constructor(override readonly retryAfterSeconds: number) {
    super('A reminder was sent less than 48 hours ago.');
  }
}

function contribution(state: AccountingState, id: string): ContributionRow {
  const row = state.contributions.find((c) => c.id === id);
  if (!row) throw new AccountingNotFoundError();
  return row;
}

function replace(state: AccountingState, row: ContributionRow): AccountingState {
  return withSettlements({
    ...state,
    contributions: state.contributions.map((c) => (c.id === row.id ? row : c)),
  });
}

/**
 * CPT-20, CPT-21, CPT-24, CPT-65 : seul l'acheteur règle une part (réglée, ou avancée avant
 * l'achat) ou annule un règlement fait par erreur, ce qui vaut aussi refus d'un « j'ai payé ».
 * La part de l'acheteur n'a rien à régler.
 */
export function setSettlement(
  state: AccountingState,
  contributionId: string,
  buyerId: string,
  settled: boolean,
  note: string | null,
  now: Date,
): AccountingState {
  if (state.buyerId !== buyerId) throw new AccountingActionForbiddenError();
  const row = contribution(state, contributionId);
  if (row.profileId === buyerId || row.amount === null) throw new AccountingActionForbiddenError();
  return replace(state, {
    ...row,
    settled: settled ? Math.max(row.amount, row.settled) : 0,
    settledAt: settled ? now : null,
    settlementNote: settled ? (note?.slice(0, SETTLEMENT_NOTE_MAX) ?? row.settlementNote) : null,
    // L'état est recalculé ; un refus efface le « j'ai payé ».
    settlement: 'NONE',
  });
}

/** CPT-22 : le participant signale « j'ai payé » ; la part passe à confirmer. */
export function claimSettlement(
  state: AccountingState,
  contributionId: string,
  participantId: string,
): AccountingState {
  const row = contribution(state, contributionId);
  if (row.profileId !== participantId || row.profileId === state.buyerId) {
    throw new AccountingActionForbiddenError();
  }
  if (row.settlement !== 'DUE') throw new AccountingActionForbiddenError();
  return {
    ...state,
    contributions: state.contributions.map((c) =>
      c.id === row.id ? { ...c, settlement: 'CLAIMED' } : c,
    ),
  };
}

/** CPT-23, CPT-66 : l'acheteur relance une part due, une fois par 48 heures. */
export function nudge(
  state: AccountingState,
  contributionId: string,
  buyerId: string,
  now: Date,
): AccountingState {
  if (state.buyerId !== buyerId) throw new AccountingActionForbiddenError();
  const row = contribution(state, contributionId);
  if (row.settlement !== 'DUE' && row.settlement !== 'CLAIMED')
    throw new AccountingActionForbiddenError();
  if (row.nudgedAt && now.getTime() - row.nudgedAt.getTime() < NUDGE_INTERVAL_MS) {
    const wait = NUDGE_INTERVAL_MS - (now.getTime() - row.nudgedAt.getTime());
    throw new NudgeTooSoonError(Math.ceil(wait / 1000));
  }
  return {
    ...state,
    contributions: state.contributions.map((c) => (c.id === row.id ? { ...c, nudgedAt: now } : c)),
  };
}
