import { Injectable } from '@nestjs/common';
import { AppEvents, Clock, IdGenerator } from '../../../shared/domain';
import { PrivateImages } from '../../catalog';
import { EventAccessReader } from '../../events';
import { ItemAccessReader } from '../../lists';
import { canDecideBuyerRequest, itemAccess } from '../../visibility';
import { participantsOf, partsOf } from '../domain/accounting-state';
import {
  AccountingActionForbiddenError,
  AccountingClosedError,
  AccountingNotFoundError,
  ContributionInvalidError,
} from '../domain/accounting.errors';
import {
  AccountingPeople,
  AccountingRepository,
  type IdempotencyInput,
  type PersonCard,
} from '../domain/accounting.ports';
import { itemCostOf, reconcileCost } from '../domain/operations';
import {
  attachReceipt,
  decideBuyerRequest,
  lowerMyRaise,
  markPurchased,
  PurchaseRequiredError,
  requestBuyer,
  shortfallOf,
  uncheckPurchase,
} from '../domain/purchase';
import { covered } from '../domain/shares';
import { AccountingGate, type GatedAccounting } from './accounting-gate';
import { type AccountingResponse, ItemAccountingMutation } from './manage-contributions.use-case';

const isParticipant = (gated: GatedAccounting) =>
  gated.level === 'participant' || gated.level === 'buyer';

/** PUT /items/{id}/purchase (CPT-12, CPT-13, CPT-16, CPT-17, CPT-55, CPT-72). */
@Injectable()
export class MarkPurchased extends ItemAccountingMutation {
  async execute(input: {
    viewerId: string;
    itemId: string;
    actualTotalMinor: number | null;
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const gated = await this.gate.forItem(input.viewerId, input.itemId);
    if (!isParticipant(gated)) throw new AccountingNotFoundError();
    if (gated.level !== 'buyer') throw new AccountingActionForbiddenError();
    const cost = gated.item ? itemCostOf(gated.item) : null;
    return this.run({
      ...input,
      gated,
      change: 'purchase',
      operate: (state, ctx) => {
        if (!state) throw new AccountingNotFoundError();
        const reconciled = cost ? reconcileCost(state, cost, ctx) : { state, closedReviews: [] };
        const done = markPurchased(reconciled.state, input.viewerId, input.actualTotalMinor, ctx);
        return {
          next: done.state,
          closedReviews: [...reconciled.closedReviews, ...done.closedReviews],
          contributionKind: 'CONTRIBUTION_ADJUSTED',
        };
      },
    });
  }
}

/** DELETE /items/{id}/purchase (CPT-14, CPT-63). */
@Injectable()
export class UncheckPurchase extends ItemAccountingMutation {
  async execute(input: {
    viewerId: string;
    itemId: string;
    confirm: boolean;
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const gated = await this.gate.forItem(input.viewerId, input.itemId);
    if (!isParticipant(gated)) throw new AccountingNotFoundError();
    if (gated.level !== 'buyer') throw new AccountingActionForbiddenError();
    return this.run({
      ...input,
      gated,
      change: 'purchase',
      operate: (state, ctx) => {
        if (!state) throw new AccountingNotFoundError();
        return {
          next: uncheckPurchase(state, input.viewerId, input.confirm, ctx.now),
          contributionKind: 'CONTRIBUTION_ADJUSTED',
        };
      },
    });
  }
}

/** POST /items/{id}/contribution/lower (CPT-18). */
@Injectable()
export class LowerContribution extends ItemAccountingMutation {
  async execute(input: {
    viewerId: string;
    itemId: string;
    amountMinor: number;
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const gated = await this.gate.forItem(input.viewerId, input.itemId);
    if (!isParticipant(gated)) throw new AccountingNotFoundError();
    return this.run({
      ...input,
      gated,
      change: 'contribution',
      operate: (state, ctx) => {
        if (!state) throw new AccountingNotFoundError();
        return {
          next: lowerMyRaise(state, input.viewerId, input.amountMinor, ctx.now),
          contributionKind: 'CONTRIBUTION_LOWERED',
        };
      },
    });
  }
}

/** POST /items/{id}/buyer-requests (CPT-10, CPT-61, CPT-72). */
@Injectable()
export class RequestBuyer extends ItemAccountingMutation {
  async execute(input: {
    viewerId: string;
    itemId: string;
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const gated = await this.gate.forItem(input.viewerId, input.itemId);
    if (!isParticipant(gated)) throw new AccountingNotFoundError();
    if (gated.item?.subject.list.event?.closed) throw new AccountingClosedError();
    return this.run({
      ...input,
      gated,
      change: 'buyer',
      operate: (state, ctx) => {
        if (!state) throw new AccountingNotFoundError();
        return {
          next: requestBuyer(state, input.viewerId, ctx),
          contributionKind: 'CONTRIBUTION_ADJUSTED',
        };
      },
    });
  }
}

/** POST /buyer-requests/{id}/accept|refuse, DELETE /buyer-requests/{id} (CPT-61). */
@Injectable()
export class DecideBuyerRequest extends ItemAccountingMutation {
  constructor(
    gate: AccountingGate,
    repository: AccountingRepository,
    people: AccountingPeople,
    ids: IdGenerator,
    clock: Clock,
    events: AppEvents,
    private readonly eventFacts: EventAccessReader,
  ) {
    super(gate, repository, people, ids, clock, events);
  }

  async execute(input: {
    viewerId: string;
    requestId: string;
    decision: 'ACCEPTED' | 'REFUSED' | 'CANCELLED';
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const owner = await this.repository.findByPendingBuyerRequest(input.requestId);
    const request = owner?.buyerRequest;
    if (!owner?.itemId || !request) throw new AccountingNotFoundError();
    const itemId = owner.itemId;
    const gated = await this.gate.forItem(input.viewerId, itemId);
    if (gated.level === 'none' || !gated.item) throw new AccountingNotFoundError();
    if (input.decision === 'CANCELLED') {
      if (request.candidateId !== input.viewerId) throw new AccountingActionForbiddenError();
    } else {
      const eventId = gated.item.eventId;
      const facts = eventId ? await this.eventFacts.accountingFacts(eventId) : null;
      const { subject } = gated.item;
      const allowed = canDecideBuyerRequest({
        level: gated.level,
        viewerId: input.viewerId,
        candidateId: request.candidateId,
        buyerId: owner.buyerId,
        requestedAt: request.createdAt,
        now: this.clock.now(),
        organizers: eventId ? (facts?.organizers ?? []) : null,
        seenAsGiver: itemAccess(subject.access, subject.item, input.viewerId) === 'giver',
      });
      if (!allowed) {
        if (!isParticipant(gated) && !(facts?.organizers.includes(input.viewerId) ?? false)) {
          throw new AccountingNotFoundError();
        }
        throw new AccountingActionForbiddenError();
      }
    }
    return this.run({
      ...input,
      itemId,
      gated,
      change: 'buyer',
      operate: (state, ctx) => {
        if (!state) throw new AccountingNotFoundError();
        const decided = decideBuyerRequest(
          state,
          input.requestId,
          input.viewerId,
          input.decision,
          ctx.now,
        );
        if (!decided) throw new AccountingNotFoundError();
        return {
          next: decided.state,
          closedBuyerRequest: decided.closed,
          contributionKind: 'CONTRIBUTION_ADJUSTED',
        };
      },
    });
  }
}

/**
 * POST /items/{id}/shortfall-notice (CPT-19) : l'auteur d'une action qui laisse un reste choisit
 * qui prévenir parmi les autres participants ; le choix n'est lu que par lui.
 */
@Injectable()
export class NotifyShortfall extends ItemAccountingMutation {
  async execute(input: {
    viewerId: string;
    itemId: string;
    profileIds: readonly string[];
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const gated = await this.gate.forItem(input.viewerId, input.itemId);
    if (!isParticipant(gated)) throw new AccountingNotFoundError();
    let notified: readonly string[] = [];
    const view = await this.run({
      ...input,
      gated,
      change: 'shortfall',
      operate: (state, ctx) => {
        if (!state) throw new AccountingNotFoundError();
        const amount = shortfallOf(state);
        if (amount <= 0) throw new ContributionInvalidError();
        const others = participantsOf(state).filter((id) => id !== input.viewerId);
        const chosen = [...new Set(input.profileIds)];
        if (chosen.some((id) => !others.includes(id))) throw new ContributionInvalidError();
        notified = chosen;
        return {
          next: state,
          contributionKind: 'SHORTFALL_NOTICE',
          notice: { id: ctx.newId(), authorId: input.viewerId, amount, notifiedIds: chosen },
        };
      },
      profileIds: () => notified,
    });
    return view;
  }
}

/** PUT /items/{id}/purchase/receipt et GET (CPT-15, CPT-62). */
@Injectable()
export class PurchaseReceipts extends ItemAccountingMutation {
  constructor(
    gate: AccountingGate,
    repository: AccountingRepository,
    people: AccountingPeople,
    ids: IdGenerator,
    clock: Clock,
    events: AppEvents,
    private readonly images: PrivateImages,
  ) {
    super(gate, repository, people, ids, clock, events);
  }

  async attach(input: {
    viewerId: string;
    itemId: string;
    photo: Buffer;
    idempotency: IdempotencyInput;
  }): Promise<AccountingResponse> {
    const gated = await this.gate.forItem(input.viewerId, input.itemId);
    if (!isParticipant(gated)) throw new AccountingNotFoundError();
    if (gated.level !== 'buyer') throw new AccountingActionForbiddenError();
    // Vérifié avant le décodage, puis de nouveau sous verrou.
    attachReceipt(gated.state ?? fail(), input.viewerId, 'check');
    const key = await this.images.store(input.photo);
    return this.run({
      ...input,
      gated,
      change: 'purchase',
      operate: (state) => {
        if (!state) throw new AccountingNotFoundError();
        return { next: attachReceipt(state, input.viewerId, key), contributionKind: 'RECEIPT_SET' };
      },
    });
  }

  /** CPT-59 : le justificatif n'est servi qu'aux participants. */
  async read(viewerId: string, itemId: string): Promise<{ bytes: Buffer; contentType: string }> {
    const gated = await this.gate.forItem(viewerId, itemId);
    if (!isParticipant(gated)) throw new AccountingNotFoundError();
    const key = gated.state?.purchase?.receiptKey;
    if (!key) throw new AccountingNotFoundError();
    const image = await this.images.read(key);
    if (!image) throw new AccountingNotFoundError();
    return image;
  }
}

function fail(): never {
  throw new PurchaseRequiredError();
}

export interface CartLine {
  readonly accountingId: string;
  readonly itemId: string | null;
  readonly title: string;
  readonly sourceUrl: string | null;
  readonly quantity: number | null;
  readonly currency: string;
  readonly totalMinor: number | null;
  readonly coveredMinor: number;
  readonly remainingMinor: number | null;
  readonly myShareMinor: number | null;
  readonly purchased: boolean;
}

export interface CartGroup {
  readonly event: { readonly id: string; readonly title: string } | null;
  readonly recipients: readonly PersonCard[];
  readonly items: readonly CartLine[];
}

/** GET /cart (CPT-11) : éléments dont je suis acheteur, par événement puis par destinataire. */
@Injectable()
export class GetCart {
  constructor(
    private readonly repository: AccountingRepository,
    private readonly items: ItemAccessReader,
    private readonly gate: AccountingGate,
    private readonly people: AccountingPeople,
    private readonly eventFacts: EventAccessReader,
  ) {}

  async execute(viewerId: string): Promise<CartGroup[]> {
    const states = await this.repository.findByBuyer(viewerId);
    const groups = new Map<
      string,
      { eventId: string | null; recipients: string[]; items: CartLine[] }
    >();
    for (const state of states) {
      const item = state.itemId ? await this.items.accountingSubject(viewerId, state.itemId) : null;
      if (this.gate.decide(viewerId, item, state).level !== 'buyer') continue;
      const eventId = item ? item.eventId : state.detachedEventId;
      const recipients = item ? [...item.recipients].sort() : [];
      const total = state.purchase
        ? (state.purchase.actual ?? state.purchase.planned)
        : state.planned;
      const coveredMinor = covered(partsOf(state));
      const line: CartLine = {
        accountingId: state.id,
        itemId: state.itemId,
        title: item?.title ?? state.detachedTitle ?? '',
        sourceUrl: item?.sourceUrl ?? null,
        quantity: item?.quantity ?? null,
        currency: state.currency,
        totalMinor: total,
        coveredMinor,
        remainingMinor: total === null ? null : Math.max(0, total - coveredMinor),
        myShareMinor: state.contributions.find((row) => row.profileId === viewerId)?.amount ?? null,
        purchased: state.purchase !== null,
      };
      const key = `${eventId ?? '-'}|${recipients.join(',')}`;
      const group = groups.get(key) ?? { eventId, recipients, items: [] };
      group.items.push(line);
      groups.set(key, group);
    }
    const cards = await this.people.cards([...groups.values()].flatMap((g) => g.recipients));
    const result: CartGroup[] = [];
    for (const group of groups.values()) {
      const title = group.eventId ? await this.eventFacts.title(viewerId, group.eventId) : null;
      result.push({
        event: group.eventId && title !== null ? { id: group.eventId, title } : null,
        recipients: group.recipients.flatMap((id) => cards.filter((c) => c.id === id)),
        items: group.items,
      });
    }
    return result;
  }
}
