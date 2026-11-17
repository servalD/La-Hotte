import { Injectable } from '@nestjs/common';
import { AppEvents, Clock, DomainError, IdGenerator } from '../../../shared/domain';
import { EventAccessReader } from '../../events';
import { GetEventProgress, ItemAccessReader } from '../../lists';
import { canSeeAmounts, canSeeSettlement } from '../../visibility';
import { type AccountingState, diffAccounting } from '../domain/accounting-state';
import { AccountingNotFoundError, ContributionInvalidError } from '../domain/accounting.errors';
import {
  AccountingPeople,
  AccountingRepository,
  type AccountingWork,
  type BudgetRecord,
  BudgetRepository,
  type IdempotencyInput,
  type PersonCard,
} from '../domain/accounting.ports';
import { isMinor } from '../domain/money';
import { withSettlements } from '../domain/purchase';
import {
  type BalanceLine,
  offsetMoves,
  owed,
  pairBalances,
  type SettlementState,
} from '../domain/settlement';
import { claimSettlement, nudge, setSettlement } from '../domain/settlement-ops';
import { AccountingGate, type GatedAccounting } from './accounting-gate';
import { type AccountingResponse, ItemAccountingMutation } from './manage-contributions.use-case';

const isParticipant = (gated: GatedAccounting) =>
  gated.level === 'participant' || gated.level === 'buyer';

/** CPT-68 : une part a changé entre la proposition et la confirmation. */
export class OffsetStaleError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'OFFSET_STALE';
  constructor() {
    super('The offset proposal is stale.');
  }
}

/** CPT-68 : rien à compenser entre ces deux profils dans cette devise. */
export class OffsetNothingError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'OFFSET_NOTHING';
  constructor() {
    super('Nothing to offset.');
  }
}

/** Fiche et décision pour un profil, élément disparu compris (CPT-73). */
async function gateOf(
  items: ItemAccessReader,
  gate: AccountingGate,
  viewerId: string,
  state: AccountingState,
): Promise<GatedAccounting> {
  const item = state.itemId ? await items.accountingSubject(viewerId, state.itemId) : null;
  return gate.decide(viewerId, item, state);
}

/** Événement d'une fiche : celui de la liste, ou celui relevé à la suppression (CPT-67). */
const eventOf = (gated: GatedAccounting): string | null =>
  gated.item ? gated.item.eventId : (gated.state?.detachedEventId ?? null);

/** PUT /contributions/{id}/settlement, POST …/claim, POST …/nudge (CPT-20 à CPT-24, CPT-65, CPT-66). */
@Injectable()
export class SettleContribution extends ItemAccountingMutation {
  constructor(
    gate: AccountingGate,
    repository: AccountingRepository,
    people: AccountingPeople,
    ids: IdGenerator,
    clock: Clock,
    events: AppEvents,
    private readonly items: ItemAccessReader,
  ) {
    super(gate, repository, people, ids, clock, events);
  }

  private async gated(viewerId: string, contributionId: string): Promise<GatedAccounting> {
    const state = await this.repository.findByContribution(contributionId);
    if (!state) throw new AccountingNotFoundError();
    const gated = await gateOf(this.items, this.gate, viewerId, state);
    const row = state.contributions.find((c) => c.id === contributionId);
    // CPT-59 : une part n'existe que pour son participant et l'acheteur.
    if (!row || !canSeeSettlement(gated.level, viewerId, row.profileId, state.buyerId)) {
      throw new AccountingNotFoundError();
    }
    return gated;
  }

  async settle(input: {
    viewerId: string;
    contributionId: string;
    settled: boolean;
    note: string | null;
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const gated = await this.gated(input.viewerId, input.contributionId);
    return this.run({
      ...input,
      gated,
      change: 'settlement',
      operate: (state, ctx) => {
        if (!state) throw new AccountingNotFoundError();
        return {
          next: setSettlement(
            state,
            input.contributionId,
            input.viewerId,
            input.settled,
            input.note,
            ctx.now,
          ),
          contributionKind: 'SETTLEMENT_SET',
        };
      },
    });
  }

  async claim(input: {
    viewerId: string;
    contributionId: string;
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const gated = await this.gated(input.viewerId, input.contributionId);
    return this.run({
      ...input,
      gated,
      change: 'settlement_claimed',
      operate: (state) => {
        if (!state) throw new AccountingNotFoundError();
        return {
          next: claimSettlement(state, input.contributionId, input.viewerId),
          contributionKind: 'SETTLEMENT_CLAIMED',
        };
      },
      profileIds: () => (gated.state?.buyerId ? [gated.state.buyerId] : []),
    });
  }

  async nudge(input: {
    viewerId: string;
    contributionId: string;
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const gated = await this.gated(input.viewerId, input.contributionId);
    const participant = gated.state?.contributions.find(
      (c) => c.id === input.contributionId,
    )?.profileId;
    return this.run({
      ...input,
      gated,
      change: 'settlement_nudged',
      operate: (state, ctx) => {
        if (!state) throw new AccountingNotFoundError();
        return {
          next: nudge(state, input.contributionId, input.viewerId, ctx.now),
          contributionKind: 'SETTLEMENT_SET',
        };
      },
      profileIds: () => (participant ? [participant] : []),
    });
  }
}

export interface BalanceDetail {
  readonly contributionId: string;
  readonly accountingId: string;
  readonly itemId: string | null;
  readonly title: string;
  readonly participantId: string;
  readonly buyerId: string;
  readonly owedMinor: number;
  readonly settlement: SettlementState;
}

export interface BalanceSummary {
  readonly other: PersonCard | null;
  readonly currency: string;
  readonly iOweMinor: number;
  readonly owesMeMinor: number;
  readonly netMinor: number;
  readonly lines: readonly BalanceDetail[];
}

/** Lignes de solde lisibles par `viewerId` (CPT-52, CPT-59, CPT-67). */
async function balanceLines(
  repository: AccountingRepository,
  items: ItemAccessReader,
  gate: AccountingGate,
  viewerId: string,
  eventId: string | null,
): Promise<{ lines: BalanceLine[]; details: Map<string, BalanceDetail> }> {
  const lines: BalanceLine[] = [];
  const details = new Map<string, BalanceDetail>();
  for (const state of await repository.findByProfile(viewerId)) {
    const gated = await gateOf(items, gate, viewerId, state);
    if (!isParticipant(gated) || state.buyerId === null) continue;
    if (eventId !== null && eventOf(gated) !== eventId) continue;
    for (const row of state.contributions) {
      if (row.profileId === null || row.amount === null) continue;
      if (row.profileId !== viewerId && state.buyerId !== viewerId) continue;
      const line: BalanceLine = {
        contributionId: row.id,
        participantId: row.profileId,
        buyerId: state.buyerId,
        currency: state.currency,
        owed: owed({
          purchased: state.purchase !== null,
          amount: row.amount,
          settled: row.settled,
        }),
        purchasedAt: state.purchase?.purchasedAt ?? null,
      };
      lines.push(line);
      details.set(row.id, {
        contributionId: row.id,
        accountingId: state.id,
        itemId: state.itemId,
        title: gated.item?.title ?? state.detachedTitle ?? '',
        participantId: row.profileId,
        buyerId: state.buyerId,
        owedMinor: line.owed,
        settlement: row.settlement,
      });
    }
  }
  return { lines, details };
}

/** GET /balances?eventId= (CPT-30 à CPT-33, CPT-67). */
@Injectable()
export class GetBalances {
  constructor(
    private readonly repository: AccountingRepository,
    private readonly items: ItemAccessReader,
    private readonly gate: AccountingGate,
    private readonly people: AccountingPeople,
  ) {}

  async execute(viewerId: string, eventId: string | null): Promise<BalanceSummary[]> {
    const { lines, details } = await balanceLines(
      this.repository,
      this.items,
      this.gate,
      viewerId,
      eventId,
    );
    const balances = pairBalances(viewerId, lines);
    const cards = await this.people.cards(balances.map((b) => b.otherId));
    return balances.map((balance) => ({
      other: cards.find((c) => c.id === balance.otherId) ?? null,
      currency: balance.currency,
      iOweMinor: balance.iOwe,
      owesMeMinor: balance.owesMe,
      netMinor: balance.net,
      lines: balance.lines.flatMap((line) => {
        const detail = details.get(line.contributionId);
        return detail ? [detail] : [];
      }),
    }));
  }
}

/** POST /offset-proposals, POST …/confirm, POST …/decline (CPT-31, CPT-68). */
@Injectable()
export class ManageOffsets {
  constructor(
    private readonly repository: AccountingRepository,
    private readonly items: ItemAccessReader,
    private readonly gate: AccountingGate,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: AppEvents,
  ) {}

  async propose(input: {
    viewerId: string;
    counterpartId: string;
    currency: string;
  }): Promise<{ id: string }> {
    if (input.counterpartId === input.viewerId) throw new OffsetNothingError();
    const { lines } = await balanceLines(
      this.repository,
      this.items,
      this.gate,
      input.viewerId,
      null,
    );
    // CPT-68 (revue SEC-40, N1) : seulement les parts que l'autre voit aussi.
    const theirs = await balanceLines(
      this.repository,
      this.items,
      this.gate,
      input.counterpartId,
      null,
    );
    const shared = lines.filter((line) => theirs.details.has(line.contributionId));
    const moves = offsetMoves(input.viewerId, input.counterpartId, input.currency, shared);
    if (moves.length === 0) throw new OffsetNothingError();
    const existing = await this.repository.pendingOffset(
      input.viewerId,
      input.counterpartId,
      input.currency,
    );
    if (existing) return { id: existing.id };
    const id = this.ids.next();
    await this.repository.createOffset({
      id,
      proposerId: input.viewerId,
      counterpartId: input.counterpartId,
      currency: input.currency,
      snapshot: moves.map((move) => ({
        contributionId: move.contributionId,
        owed: lines.find((l) => l.contributionId === move.contributionId)?.owed ?? 0,
      })),
      status: 'PENDING',
      createdAt: this.clock.now(),
    });
    return { id };
  }

  /** Confirmer (l'autre seulement) ou décliner (l'un ou l'autre). */
  async decide(input: {
    viewerId: string;
    proposalId: string;
    confirm: boolean;
    idempotency: IdempotencyInput;
  }): Promise<{ status: 'CONFIRMED' | 'DECLINED' }> {
    const proposal = await this.repository.findOffset(input.proposalId);
    const party =
      proposal &&
      (proposal.proposerId === input.viewerId || proposal.counterpartId === input.viewerId);
    if (!proposal || !party || proposal.status !== 'PENDING') throw new AccountingNotFoundError();
    if (!input.confirm) {
      await this.repository.setOffsetStatus(proposal.id, 'DECLINED', this.clock.now());
      return { status: 'DECLINED' };
    }
    if (proposal.counterpartId !== input.viewerId) throw new AccountingNotFoundError();
    const owners = await Promise.all(
      proposal.snapshot.map((entry) => this.repository.findByContribution(entry.contributionId)),
    );
    const accountingIds = owners.flatMap((state) => (state ? [state.id] : []));
    const now = this.clock.now();
    // CPT-68 (revue SEC-40, N1) : chaque fiche doit encore être vue par les deux, sinon la
    // proposition est caduque et répond comme une inconnue (aucun état de la fiche n'en sort).
    for (const state of owners) {
      const seen =
        state !== null &&
        (
          await Promise.all(
            [proposal.proposerId, proposal.counterpartId].map((id) =>
              gateOf(this.items, this.gate, id, state),
            ),
          )
        ).every((gated) => isParticipant(gated));
      if (!seen) {
        await this.repository.setOffsetStatus(proposal.id, 'STALE', now);
        throw new AccountingNotFoundError();
      }
    }
    try {
      await this.repository.mutateMany({
        accountingIds,
        actorId: input.viewerId,
        operationId: this.ids.next(),
        idempotency: input.idempotency,
        proposal: { id: proposal.id, status: 'CONFIRMED' },
        work: (states) => {
          const all = [...states.values()];
          const lines: BalanceLine[] = all.flatMap((state) =>
            state.contributions.flatMap((row) =>
              row.profileId && state.buyerId && row.amount !== null
                ? [
                    {
                      contributionId: row.id,
                      participantId: row.profileId,
                      buyerId: state.buyerId,
                      currency: state.currency,
                      owed: owed({
                        purchased: state.purchase !== null,
                        amount: row.amount,
                        settled: row.settled,
                      }),
                      purchasedAt: state.purchase?.purchasedAt ?? null,
                    },
                  ]
                : [],
            ),
          );
          for (const entry of proposal.snapshot) {
            const line = lines.find((l) => l.contributionId === entry.contributionId);
            if (line?.owed !== entry.owed) throw new OffsetStaleError();
          }
          const moves = offsetMoves(
            proposal.proposerId,
            proposal.counterpartId,
            proposal.currency,
            lines,
          );
          const works: AccountingWork[] = [];
          for (const state of all) {
            const touched = moves.filter((m) =>
              state.contributions.some((c) => c.id === m.contributionId),
            );
            if (touched.length === 0) continue;
            const next = withSettlements({
              ...state,
              contributions: state.contributions.map((row) => {
                const move = touched.find((m) => m.contributionId === row.id);
                return move ? { ...row, settled: row.settled + move.add, settledAt: now } : row;
              }),
            });
            const diff = diffAccounting(state, next, {
              header: 'ACCOUNTING_UPDATED',
              contribution: () => 'SETTLEMENT_OFFSET',
            });
            works.push({ next, diff, response: { status: 200, body: null } });
          }
          return { works, response: { status: 200, body: { status: 'CONFIRMED' } } };
        },
      });
    } catch (error) {
      if (error instanceof OffsetStaleError) {
        await this.repository.setOffsetStatus(proposal.id, 'STALE', now);
      }
      throw error;
    }
    for (const state of owners) {
      if (!state) continue;
      this.events.publish({
        type: 'accounting.changed',
        accountingId: state.id,
        itemId: state.itemId,
        change: 'settlement',
        actorId: input.viewerId,
        participantIds: state.contributions.flatMap((row) =>
          row.profileId ? [row.profileId] : [],
        ),
        buyerId: state.buyerId,
      });
    }
    return { status: 'CONFIRMED' };
  }
}

/** GET/PUT /budgets, DELETE /budgets/{id} (CPT-40, CPT-69) : privés à leur profil. */
@Injectable()
export class ManageBudgets {
  constructor(
    private readonly budgets: BudgetRepository,
    private readonly events: EventAccessReader,
    private readonly progress: GetEventProgress,
    private readonly ids: IdGenerator,
  ) {}

  list(viewerId: string, eventId: string | null): Promise<BudgetRecord[]> {
    return this.budgets.list(viewerId, eventId);
  }

  async put(input: {
    viewerId: string;
    eventId: string;
    recipientId: string | null;
    amountMinor: number;
    currency: string;
  }): Promise<BudgetRecord> {
    if (!isMinor(input.amountMinor) || input.amountMinor === 0)
      throw new ContributionInvalidError();
    if (!(await this.events.viewers(input.eventId, [input.viewerId])).has(input.viewerId)) {
      throw new AccountingNotFoundError();
    }
    if (input.recipientId !== null) {
      const { recipients } = await this.progress.execute({
        viewerId: input.viewerId,
        eventId: input.eventId,
      });
      if (!recipients.includes(input.recipientId)) throw new ContributionInvalidError();
    }
    return this.budgets.upsert({
      id: this.ids.next(),
      profileId: input.viewerId,
      eventId: input.eventId,
      recipientId: input.recipientId,
      amountMinor: input.amountMinor,
      currency: input.currency,
    });
  }

  async delete(viewerId: string, id: string): Promise<void> {
    if (!(await this.budgets.delete(viewerId, id))) throw new AccountingNotFoundError();
  }
}

export interface OverviewLine {
  readonly accountingId: string;
  readonly itemId: string | null;
  readonly title: string;
  readonly currency: string;
  readonly mode: 'FULL' | 'PERCENT' | 'FIXED';
  readonly amountMinor: number | null;
  readonly isBuyer: boolean;
  readonly buyer: PersonCard | null;
  readonly purchased: boolean;
  readonly settlement: SettlementState;
}

export interface OverviewGroup {
  readonly recipients: readonly PersonCard[];
  /** CPT-45 : hors événement, mois de ma première participation (AAAA-MM). */
  readonly month: string | null;
  readonly budgetMinor: number | null;
  readonly totals: readonly { readonly currency: string; readonly amountMinor: number }[];
  readonly lines: readonly OverviewLine[];
}

export interface Overview {
  readonly event: { readonly id: string; readonly title: string } | null;
  readonly budget: { readonly amountMinor: number; readonly currency: string } | null;
  readonly engaged: readonly { readonly currency: string; readonly amountMinor: number }[];
  readonly groups: readonly OverviewGroup[];
  /** CPT-44 : destinataires de l'événement pour qui je n'ai rien prévu. */
  readonly nothingYet: readonly PersonCard[];
}

function totals(lines: readonly OverviewLine[]) {
  const sums = new Map<string, number>();
  for (const line of lines)
    sums.set(line.currency, (sums.get(line.currency) ?? 0) + (line.amountMinor ?? 0));
  return [...sums.entries()].sort().map(([currency, amountMinor]) => ({ currency, amountMinor }));
}

/** GET /accounting/overview?eventId= (CPT-41 à CPT-45, CPT-69) : la vue latérale. */
@Injectable()
export class GetAccountingOverview {
  constructor(
    private readonly repository: AccountingRepository,
    private readonly items: ItemAccessReader,
    private readonly gate: AccountingGate,
    private readonly people: AccountingPeople,
    private readonly events: EventAccessReader,
    private readonly progress: GetEventProgress,
    private readonly budgets: BudgetRepository,
  ) {}

  async execute(viewerId: string, eventId: string | null): Promise<Overview> {
    let event: Overview['event'] = null;
    if (eventId !== null) {
      const title = await this.events.title(viewerId, eventId);
      if (title === null) throw new AccountingNotFoundError();
      event = { id: eventId, title };
    }
    const groups = new Map<
      string,
      { recipients: string[]; month: string | null; lines: OverviewLine[] }
    >();
    const buyerIds = new Set<string>();
    const buyerOf = new Map<string, string>();
    for (const state of await this.repository.findByProfile(viewerId)) {
      const gated = await gateOf(this.items, this.gate, viewerId, state);
      if (!canSeeAmounts(gated.level)) continue;
      const mine = state.contributions.find((row) => row.profileId === viewerId);
      if (!mine) continue;
      const itemEvent = eventOf(gated);
      if (itemEvent !== eventId) continue;
      const recipients = gated.item ? [...gated.item.recipients].sort() : [];
      const month = eventId === null ? mine.createdAt.toISOString().slice(0, 7) : null;
      const key = eventId === null ? (month ?? '') : recipients.join(',');
      const group = groups.get(key) ?? {
        recipients: eventId === null ? [] : recipients,
        month,
        lines: [],
      };
      if (state.buyerId) {
        buyerIds.add(state.buyerId);
        buyerOf.set(state.id, state.buyerId);
      }
      group.lines.push({
        accountingId: state.id,
        itemId: state.itemId,
        title: gated.item?.title ?? state.detachedTitle ?? '',
        currency: state.currency,
        mode: mine.mode,
        amountMinor: mine.amount,
        isBuyer: state.buyerId === viewerId,
        buyer: null,
        purchased: state.purchase !== null,
        settlement: mine.settlement,
      });
      groups.set(key, group);
    }
    const budgets = eventId === null ? [] : await this.budgets.list(viewerId, eventId);
    const global = budgets.find((b) => b.recipientId === null) ?? null;
    const recipientsOfEvent =
      eventId === null ? [] : (await this.progress.execute({ viewerId, eventId })).recipients;
    const served = new Set([...groups.values()].flatMap((g) => g.recipients));
    const nothing = recipientsOfEvent.filter((id) => !served.has(id));
    const cards = await this.people.cards([
      ...[...groups.values()].flatMap((g) => g.recipients),
      ...nothing,
      ...buyerIds,
    ]);
    const card = (id: string) => cards.find((c) => c.id === id) ?? null;
    const allLines = [...groups.values()].flatMap((g) => g.lines);
    return {
      event,
      budget: global ? { amountMinor: global.amountMinor, currency: global.currency } : null,
      engaged: totals(allLines),
      groups: [...groups.values()].map((group) => ({
        recipients: group.recipients.flatMap((id) => {
          const c = card(id);
          return c ? [c] : [];
        }),
        month: group.month,
        budgetMinor:
          group.recipients.length === 1
            ? (budgets.find((b) => b.recipientId === group.recipients[0])?.amountMinor ?? null)
            : null,
        totals: totals(group.lines),
        lines: group.lines.map((line) => ({
          ...line,
          buyer: card(buyerOf.get(line.accountingId) ?? ''),
        })),
      })),
      nothingYet: nothing.flatMap((id) => {
        const c = card(id);
        return c ? [c] : [];
      }),
    };
  }
}
