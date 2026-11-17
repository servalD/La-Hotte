import { Injectable } from '@nestjs/common';
import { AppEvents, type AccountingChanged, Clock, IdGenerator } from '../../../shared/domain';
import { FollowRepository } from '../../conversations';
import { ItemAccessReader } from '../../lists';
import { accountingLevel, canDecideReview } from '../../visibility';
import {
  type AccountingState,
  diffAccounting,
  openAccounting,
  participantsOf,
  type BuyerRequestRow,
  type ReviewRow,
} from '../domain/accounting-state';
import type { LedgerKind } from '../domain/ledger';
import {
  AccountingActionForbiddenError,
  AccountingClosedError,
  AccountingNotFoundError,
} from '../domain/accounting.errors';
import {
  AccountingPeople,
  AccountingRepository,
  type IdempotencyInput,
  type MutateResult,
  type ShortfallNoticeDraft,
} from '../domain/accounting.ports';
import {
  type AccountingOptions,
  changeOptions,
  type ContributionInput,
  decideReview,
  itemCostOf,
  type OperationContext,
  reconcileCost,
  removeContribution,
  setContribution,
} from '../domain/operations';
import { AccountingGate, type GatedAccounting } from './accounting-gate';
import { type AccountingViewModel, buildAccountingView, peopleOf } from './accounting-view';

/** Vue rendue par une mutation : lue par le cas d'usage, ou rejouée (CPT-71). */
export type AccountingResponse = AccountingViewModel;

@Injectable()
export class AccountingViews {
  constructor(
    private readonly gate: AccountingGate,
    private readonly people: AccountingPeople,
  ) {}

  /** CPT-59 : `404` à qui n'a pas la compta, destinataire compris (VIS-20, VIS-34). */
  async forItem(viewerId: string, itemId: string): Promise<AccountingViewModel> {
    const gated = await this.gate.forItem(viewerId, itemId);
    if (gated.level === 'none') throw new AccountingNotFoundError();
    const cards = await this.people.cards(peopleOf(gated.state));
    return buildAccountingView({
      level: gated.level,
      viewerId,
      item: gated.item,
      state: gated.state,
      cards,
      canContribute: gated.canContribute,
    });
  }
}

/** Ce qu'une opération sous verrou rend au socle commun. */
export interface OperateResult {
  readonly next: AccountingState;
  readonly closedReviews?: readonly ReviewRow[];
  readonly closedBuyerRequest?: BuyerRequestRow | null;
  readonly contributionKind: LedgerKind;
  readonly notice?: ShortfallNoticeDraft;
}

/** Socle commun des mutations sur la compta d'un élément vu (ADR 0019). */
@Injectable()
export abstract class ItemAccountingMutation {
  constructor(
    protected readonly gate: AccountingGate,
    protected readonly repository: AccountingRepository,
    protected readonly people: AccountingPeople,
    protected readonly ids: IdGenerator,
    protected readonly clock: Clock,
    protected readonly events: AppEvents,
  ) {}

  protected context(): OperationContext {
    return { now: this.clock.now(), newId: () => this.ids.next() };
  }

  protected async run(input: {
    readonly viewerId: string;
    /** Absent pour une fiche détachée (CPT-73) : la clé est alors la fiche. */
    readonly itemId?: string | null;
    readonly idempotency: IdempotencyInput;
    readonly gated: GatedAccounting;
    readonly change: AccountingChanged['change'];
    readonly operate: (state: AccountingState | null, ctx: OperationContext) => OperateResult;
    /** CPT-19 : profils choisis, portés par l'avis (lus après l'opération). */
    readonly profileIds?: () => readonly string[];
  }): Promise<AccountingResponse> {
    const { gated, viewerId } = input;
    const item = gated.item;
    const itemId = item?.itemId ?? null;
    if (!item && !gated.state) throw new AccountingNotFoundError();
    const key = item ? { itemId: item.itemId } : { accountingId: gated.state?.id ?? '' };
    const cards = await this.people.cards([...peopleOf(gated.state), viewerId]);
    const ctx = this.context();
    const result: MutateResult = await this.repository.mutate({
      key,
      actorId: viewerId,
      operationId: this.ids.next(),
      idempotency: input.idempotency,
      work: (state) => {
        const { next, closedReviews, contributionKind, closedBuyerRequest, notice } = input.operate(
          state,
          ctx,
        );
        const diff = diffAccounting(
          state,
          next,
          {
            header: 'ACCOUNTING_UPDATED',
            contribution: (row) =>
              row.profileId === viewerId ? contributionKind : 'CONTRIBUTION_ADJUSTED',
            review: 'REVIEW_DECIDED',
          },
          closedReviews ?? [],
          closedBuyerRequest ?? null,
        );
        // CPT-19, CPT-70 : l'avis d'un reste est une écriture du journal comme une autre.
        if (notice) {
          diff.ledger.push({
            kind: 'SHORTFALL_NOTICE',
            targetId: notice.id,
            before: null,
            after: {
              amount: notice.amount,
              authorId: notice.authorId,
              notifiedIds: [...notice.notifiedIds],
            },
          });
        }
        const level = accountingLevel(
          item?.subject ?? null,
          { participants: participantsOf(next), buyerId: next.buyerId },
          viewerId,
        );
        const body = buildAccountingView({
          level: level === 'none' ? 'giver' : level,
          viewerId,
          item,
          state: next,
          cards,
          canContribute: gated.canContribute,
        });
        return { next, diff, response: { status: 200, body }, ...(notice ? { notice } : {}) };
      },
    });
    if (!result.replayed) {
      this.events.publish({
        type: 'accounting.changed',
        accountingId: result.state.id,
        itemId,
        change: input.change,
        actorId: viewerId,
        participantIds: participantsOf(result.state),
        buyerId: result.state.buyerId,
        ...(input.profileIds ? { profileIds: input.profileIds() } : {}),
      });
    }
    return result.response.body as AccountingResponse;
  }
}

/** PUT /items/{id}/contribution (CPT-01 à CPT-07, CPT-53 à CPT-57, CPT-60, NOT-13). */
@Injectable()
export class SetContribution extends ItemAccountingMutation {
  constructor(
    gate: AccountingGate,
    repository: AccountingRepository,
    people: AccountingPeople,
    ids: IdGenerator,
    clock: Clock,
    events: AppEvents,
    private readonly follows: FollowRepository,
  ) {
    super(gate, repository, people, ids, clock, events);
  }

  async execute(input: {
    viewerId: string;
    itemId: string;
    contribution: ContributionInput;
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const gated = await this.gate.forItem(input.viewerId, input.itemId);
    if (gated.level === 'none' || !gated.item) throw new AccountingNotFoundError();
    if (!gated.canContribute) throw new AccountingClosedError();
    const item = gated.item;
    const cost = itemCostOf(item);
    // NOT-12 : « quelqu'un rejoint » seulement à la première participation.
    const joined = !gated.state?.contributions.some((row) => row.profileId === input.viewerId);
    const view = await this.run({
      ...input,
      gated,
      change: joined ? 'joined' : 'contribution',
      operate: (state, ctx) => {
        const opened =
          state ??
          openAccounting({
            id: ctx.newId(),
            itemId: item.itemId,
            currency: cost.currency,
            planned: cost.total,
          });
        const reconciled = reconcileCost(opened, cost, ctx);
        return {
          next: setContribution(
            reconciled.state,
            input.viewerId,
            input.contribution,
            item.unitPriceMinor,
            item.quantity,
            ctx,
          ),
          closedReviews: reconciled.closedReviews,
          contributionKind: 'CONTRIBUTION_SET',
        };
      },
    });
    // NOT-03, NOT-13 : on suit d'office l'élément qu'on finance (un désabonnement explicite reste).
    await this.follows.followByDefault(input.itemId, input.viewerId);
    return view;
  }
}

/** DELETE /items/{id}/contribution (CPT-06, CPT-65, CPT-72, CPT-73, VIS-37). */
@Injectable()
export class RemoveContribution extends ItemAccountingMutation {
  async execute(input: {
    viewerId: string;
    itemId: string;
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const gated = await this.gate.forItem(input.viewerId, input.itemId);
    if (gated.level !== 'participant' && gated.level !== 'buyer')
      throw new AccountingNotFoundError();
    // CPT-72 : plus de retrait une fois l'événement terminé ou annulé.
    if (gated.item?.subject.list.event?.closed) throw new AccountingClosedError();
    return this.run({
      ...input,
      gated,
      change: 'contribution',
      operate: (state, ctx) => {
        if (!state) throw new AccountingNotFoundError();
        const removed = removeContribution(state, input.viewerId);
        if (!removed) throw new AccountingNotFoundError();
        // CPT-61 : la demande d'un candidat qui se retire est annulée.
        const request = removed.buyerRequest;
        const cancels = request !== null && request.candidateId === input.viewerId;
        return {
          next: cancels ? { ...removed, buyerRequest: null } : removed,
          closedBuyerRequest: cancels
            ? { ...request, status: 'CANCELLED', decidedBy: input.viewerId, decidedAt: ctx.now }
            : null,
          contributionKind: 'CONTRIBUTION_REMOVED',
        };
      },
    });
  }
}

/** PUT /items/{id}/accounting/options (CPT-58, CPT-72). */
@Injectable()
export class SetAccountingOptions extends ItemAccountingMutation {
  async execute(input: {
    viewerId: string;
    itemId: string;
    options: AccountingOptions;
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const gated = await this.gate.forItem(input.viewerId, input.itemId);
    if (gated.level !== 'participant' && gated.level !== 'buyer')
      throw new AccountingNotFoundError();
    if (gated.item?.subject.list.event?.closed) throw new AccountingClosedError();
    const cost = gated.item ? itemCostOf(gated.item) : null;
    return this.run({
      ...input,
      gated,
      change: 'options',
      operate: (state, ctx) => {
        if (!state) throw new AccountingNotFoundError();
        const reconciled = cost ? reconcileCost(state, cost, ctx) : { state, closedReviews: [] };
        const changed = changeOptions(reconciled.state, input.viewerId, input.options, ctx);
        return {
          next: changed.state,
          closedReviews: [...reconciled.closedReviews, ...changed.closedReviews],
          contributionKind: 'CONTRIBUTION_SET',
        };
      },
    });
  }
}

/** POST /accounting-reviews/{id}/approve|refuse (CPT-58). */
@Injectable()
export class DecideAccountingReview extends ItemAccountingMutation {
  async execute(input: {
    viewerId: string;
    reviewId: string;
    approve: boolean;
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const owner = await this.repository.findByPendingReview(input.reviewId);
    if (!owner?.itemId) throw new AccountingNotFoundError();
    const itemId = owner.itemId;
    const gated = await this.gate.forItem(input.viewerId, itemId);
    if (gated.level !== 'participant' && gated.level !== 'buyer')
      throw new AccountingNotFoundError();
    const review = gated.state?.reviews.find((row) => row.id === input.reviewId);
    if (!review) throw new AccountingNotFoundError();
    if (!canDecideReview(gated.level, input.viewerId, review.authorId)) {
      throw new AccountingActionForbiddenError();
    }
    const cost = gated.item ? itemCostOf(gated.item) : null;
    return this.run({
      ...input,
      itemId,
      gated,
      change: 'review_decided',
      operate: (state, ctx) => {
        if (!state) throw new AccountingNotFoundError();
        const reconciled = cost ? reconcileCost(state, cost, ctx) : { state, closedReviews: [] };
        const decided = decideReview(
          reconciled.state,
          input.reviewId,
          input.viewerId,
          input.approve,
          ctx,
        );
        // La demande a pu être remplacée ou close entre la lecture et le verrou.
        if (!decided) throw new AccountingNotFoundError();
        return {
          next: decided.state,
          closedReviews: [...reconciled.closedReviews, ...decided.closedReviews],
          contributionKind: 'CONTRIBUTION_SET',
        };
      },
    });
  }
}

/**
 * CPT-57, CPT-58 : réconciliation du coût après un changement de l'élément (abonné au bus,
 * ADR 0019). L'auteur du changement est l'auteur de la demande de revue : il ne la valide pas.
 * Opération du système, sans clé d'idempotence ; chaque écriture suivante refait la comparaison,
 * si bien qu'un avis perdu ne laisse jamais la compta en retard.
 */
@Injectable()
export class ReconcileItemCost {
  constructor(
    private readonly items: ItemAccessReader,
    private readonly repository: AccountingRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: AppEvents,
  ) {}

  async execute(input: { itemId: string; actorId: string | null }): Promise<void> {
    const state = await this.repository.findByItem(input.itemId);
    if (!state) return;
    const item = await this.items.accountingSubject(
      input.actorId ?? state.buyerId ?? '',
      input.itemId,
    );
    if (!item) return;
    const cost = itemCostOf(item);
    const ctx: OperationContext = { now: this.clock.now(), newId: () => this.ids.next() };
    const outcome = { changed: false };
    const result = await this.repository.mutate({
      key: { itemId: input.itemId },
      actorId: input.actorId,
      operationId: this.ids.next(),
      idempotency: null,
      work: (current) => {
        if (!current) throw new AccountingNotFoundError();
        const reconciled = reconcileCost(current, cost, ctx, input.actorId);
        const diff = diffAccounting(
          current,
          reconciled.state,
          {
            header: 'ACCOUNTING_COST',
            contribution: () => 'CONTRIBUTION_ADJUSTED',
            review: 'REVIEW_OPENED',
          },
          reconciled.closedReviews,
        );
        outcome.changed = diff.ledger.length > 0;
        return { next: reconciled.state, diff, response: { status: 200, body: null } };
      },
    });
    if (outcome.changed && !result.replayed) {
      this.events.publish({
        type: 'accounting.changed',
        accountingId: result.state.id,
        itemId: input.itemId,
        change: 'review_opened',
        actorId: input.actorId,
        participantIds: participantsOf(result.state),
        buyerId: result.state.buyerId,
      });
    }
  }
}
