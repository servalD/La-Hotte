import { AccountingNotFoundError, IdempotencyKeyReusedError } from '../domain/accounting.errors';
import {
  type AccountingState,
  itemStatusOf,
  type LedgerDraft,
  type ReviewRow,
} from '../domain/accounting-state';
import {
  type AccountingKey,
  AccountingPeople,
  type BudgetRecord,
  BudgetRepository,
  type DueReminder,
  type OffsetProposal,
  type OffsetStatus,
  AccountingRepository,
  type AccountingWork,
  type IdempotencyInput,
  type MutateResult,
  type PersonCard,
  type StoredResponse,
} from '../domain/accounting.ports';

export interface StoredLedgerEntry extends LedgerDraft {
  readonly id: string;
  readonly accountingId: string;
  readonly actorId: string | null;
  readonly operationId: string;
  readonly at: Date;
}

/**
 * Double en mémoire du dépôt de compta (tests de contrat). Les opérations d'une même fiche sont
 * sérialisées comme sous le verrou de PostgreSQL ; la clé d'idempotence se comporte comme
 * l'index unique.
 */
export class InMemoryAccountingRepository extends AccountingRepository {
  readonly states = new Map<string, AccountingState>();
  readonly ledger: StoredLedgerEntry[] = [];
  readonly decidedReviews: ReviewRow[] = [];
  private readonly idempotency = new Map<string, { hash: string; response: StoredResponse }>();
  private queue: Promise<unknown> = Promise.resolve();
  private sequence = 0;

  constructor(
    private readonly setItemStatus: (
      itemId: string,
      status: 'OPEN' | 'RESERVED' | 'PURCHASED',
    ) => void = () => undefined,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  mutate(input: {
    readonly key: AccountingKey;
    readonly actorId: string | null;
    readonly operationId: string;
    readonly idempotency: IdempotencyInput | null;
    readonly work: (state: AccountingState | null) => AccountingWork;
  }): Promise<MutateResult> {
    const run = this.queue.then(() => this.apply(input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private apply(input: {
    readonly key: AccountingKey;
    readonly actorId: string | null;
    readonly operationId: string;
    readonly idempotency: IdempotencyInput | null;
    readonly work: (state: AccountingState | null) => AccountingWork;
  }): MutateResult {
    const idem = input.idempotency;
    const idemKey = idem ? `${idem.profileId}:${idem.key}` : null;
    const known = idemKey ? this.idempotency.get(idemKey) : undefined;
    if (known && idem) {
      if (known.hash !== idem.requestHash) throw new IdempotencyKeyReusedError();
      return { replayed: true, response: known.response };
    }
    const prev = this.lookup(input.key);
    const work = input.work(prev);
    const next: AccountingState = { ...work.next, version: (prev?.version ?? 0) + 1 };
    this.states.set(next.id, next);
    for (const review of work.diff.reviews.upsert) {
      if (review.status !== 'PENDING') this.decidedReviews.push(review);
    }
    const at = this.now();
    for (const draft of work.diff.ledger) {
      this.sequence += 1;
      this.ledger.push({
        ...draft,
        id: String(this.sequence).padStart(12, '0'),
        accountingId: next.id,
        actorId: input.actorId,
        operationId: input.operationId,
        at,
      });
    }
    if (work.notice) {
      this.notices.push({
        accountingId: next.id,
        authorId: work.notice.authorId,
        amount: work.notice.amount,
        notifiedIds: work.notice.notifiedIds,
      });
    }
    if (next.itemId) this.setItemStatus(next.itemId, itemStatusOf(next));
    if (idemKey && idem) {
      this.idempotency.set(idemKey, { hash: idem.requestHash, response: work.response });
    }
    return { replayed: false, state: next, response: work.response };
  }

  private lookup(key: AccountingKey): AccountingState | null {
    if ('accountingId' in key) return this.states.get(key.accountingId) ?? null;
    for (const state of this.states.values()) if (state.itemId === key.itemId) return state;
    return null;
  }

  findByItem(itemId: string): Promise<AccountingState | null> {
    return Promise.resolve(this.lookup({ itemId }));
  }

  findById(accountingId: string): Promise<AccountingState | null> {
    return Promise.resolve(this.lookup({ accountingId }));
  }

  readonly notices: {
    accountingId: string;
    authorId: string;
    amount: number;
    notifiedIds: readonly string[];
  }[] = [];

  findByPendingBuyerRequest(requestId: string): Promise<AccountingState | null> {
    for (const state of this.states.values()) {
      if (state.buyerRequest?.id === requestId) return Promise.resolve(state);
    }
    return Promise.resolve(null);
  }

  readonly offsets = new Map<string, OffsetProposal>();

  findByContribution(contributionId: string): Promise<AccountingState | null> {
    for (const state of this.states.values()) {
      if (state.contributions.some((row) => row.id === contributionId))
        return Promise.resolve(state);
    }
    return Promise.resolve(null);
  }

  findByProfile(profileId: string): Promise<AccountingState[]> {
    return Promise.resolve(
      [...this.states.values()].filter(
        (state) =>
          state.buyerId === profileId ||
          state.contributions.some((row) => row.profileId === profileId),
      ),
    );
  }

  mutateMany(input: {
    readonly accountingIds: readonly string[];
    readonly actorId: string;
    readonly operationId: string;
    readonly idempotency: IdempotencyInput;
    readonly proposal: { readonly id: string; readonly status: OffsetStatus };
    readonly work: (states: ReadonlyMap<string, AccountingState>) => {
      readonly works: readonly AccountingWork[];
      readonly response: StoredResponse;
    };
  }): Promise<{ readonly replayed: boolean; readonly response: StoredResponse }> {
    const run = this.queue.then(() => {
      const idem = input.idempotency;
      const idemKey = `${idem.profileId}:${idem.key}`;
      const known = this.idempotency.get(idemKey);
      if (known) {
        if (known.hash !== idem.requestHash) throw new IdempotencyKeyReusedError();
        return { replayed: true, response: known.response };
      }
      if (this.offsets.get(input.proposal.id)?.status !== 'PENDING') {
        throw new AccountingNotFoundError();
      }
      const states = new Map<string, AccountingState>();
      for (const id of input.accountingIds) {
        const state = this.states.get(id);
        if (state) states.set(id, state);
      }
      const result = input.work(states);
      const at = this.now();
      for (const work of result.works) {
        const prev = this.states.get(work.next.id);
        this.states.set(work.next.id, { ...work.next, version: (prev?.version ?? 0) + 1 });
        for (const draft of work.diff.ledger) {
          this.sequence += 1;
          this.ledger.push({
            ...draft,
            id: String(this.sequence).padStart(12, '0'),
            accountingId: work.next.id,
            actorId: input.actorId,
            operationId: input.operationId,
            at,
          });
        }
      }
      const proposal = this.offsets.get(input.proposal.id);
      if (proposal) this.offsets.set(proposal.id, { ...proposal, status: input.proposal.status });
      this.idempotency.set(idemKey, { hash: idem.requestHash, response: result.response });
      return { replayed: false, response: result.response };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Réglé par les tests : rappels échus à rendre au prochain passage. */
  readonly dueReminders: DueReminder[] = [];
  readonly shortfallAccountings: string[] = [];

  claimDueReminders(): Promise<DueReminder[]> {
    return Promise.resolve(this.dueReminders.splice(0));
  }

  shortfallsAfterEvent(): Promise<string[]> {
    return Promise.resolve(this.shortfallAccountings.splice(0));
  }

  createOffset(proposal: OffsetProposal): Promise<void> {
    this.offsets.set(proposal.id, proposal);
    return Promise.resolve();
  }

  findOffset(id: string): Promise<OffsetProposal | null> {
    return Promise.resolve(this.offsets.get(id) ?? null);
  }

  pendingOffset(a: string, b: string, currency: string): Promise<OffsetProposal | null> {
    for (const p of this.offsets.values()) {
      const pair = [p.proposerId, p.counterpartId].sort().join();
      if (p.status === 'PENDING' && p.currency === currency && pair === [a, b].sort().join()) {
        return Promise.resolve(p);
      }
    }
    return Promise.resolve(null);
  }

  pendingOffsetsOf(profileId: string): Promise<OffsetProposal[]> {
    return Promise.resolve(
      [...this.offsets.values()]
        .filter(
          (p) =>
            p.status === 'PENDING' && (p.proposerId === profileId || p.counterpartId === profileId),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    );
  }

  setOffsetStatus(id: string, status: OffsetStatus): Promise<void> {
    const p = this.offsets.get(id);
    if (p) this.offsets.set(id, { ...p, status });
    return Promise.resolve();
  }

  findByBuyer(profileId: string): Promise<AccountingState[]> {
    return Promise.resolve(
      [...this.states.values()].filter((state) => state.buyerId === profileId),
    );
  }

  findByPendingReview(reviewId: string): Promise<AccountingState | null> {
    for (const state of this.states.values()) {
      if (state.reviews.some((row) => row.id === reviewId)) return Promise.resolve(state);
    }
    return Promise.resolve(null);
  }

  /** CPT-73 : ce que fait le déclencheur de la base quand l'élément disparaît. */
  detach(
    itemId: string,
    title: string,
    eventId: string | null,
    excluded: readonly string[] = [],
  ): void {
    for (const state of this.states.values()) {
      if (state.itemId !== itemId) continue;
      this.states.set(state.id, {
        ...state,
        itemId: null,
        detachedTitle: title,
        detachedEventId: eventId,
        detachedAt: this.now(),
        detachedExcluded: excluded,
        version: state.version + 1,
      });
    }
  }
}

export class InMemoryAccountingPeople extends AccountingPeople {
  readonly people = new Map<string, PersonCard>();

  cards(profileIds: readonly string[]): Promise<PersonCard[]> {
    return Promise.resolve(
      [...new Set(profileIds)].map(
        (id) =>
          this.people.get(id) ?? {
            id,
            displayName: 'Profil',
            avatar: null,
            accentColor: '#888888',
          },
      ),
    );
  }
}

export class InMemoryBudgetRepository extends BudgetRepository {
  readonly budgets = new Map<string, BudgetRecord>();

  list(profileId: string, eventId: string | null): Promise<BudgetRecord[]> {
    return Promise.resolve(
      [...this.budgets.values()].filter(
        (b) => b.profileId === profileId && (eventId === null || b.eventId === eventId),
      ),
    );
  }

  upsert(budget: BudgetRecord): Promise<BudgetRecord> {
    for (const existing of this.budgets.values()) {
      if (
        existing.profileId === budget.profileId &&
        existing.eventId === budget.eventId &&
        existing.recipientId === budget.recipientId
      ) {
        const next = { ...budget, id: existing.id };
        this.budgets.set(existing.id, next);
        return Promise.resolve(next);
      }
    }
    this.budgets.set(budget.id, budget);
    return Promise.resolve(budget);
  }

  delete(profileId: string, id: string): Promise<boolean> {
    const budget = this.budgets.get(id);
    if (budget?.profileId !== profileId) return Promise.resolve(false);
    this.budgets.delete(id);
    return Promise.resolve(true);
  }
}
