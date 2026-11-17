import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IdGenerator } from '../../../shared/domain';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { AccountingNotFoundError, IdempotencyKeyReusedError } from '../domain/accounting.errors';
import {
  type AccountingState,
  type ContributionRow,
  itemStatusOf,
  type PurchaseRow,
  type ReviewProposal,
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
  type StoredResponse,
  AccountingRepository,
  type AccountingWork,
  type IdempotencyInput,
  type MutateResult,
  type PersonCard,
} from '../domain/accounting.ports';

type Tx = Prisma.TransactionClient;

/** CPT-71 : durée de vie d'une clé d'idempotence. */
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const STATE_INCLUDE = {
  contributions: true,
  purchase: true,
  reviews: { where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } },
  buyerRequests: { where: { status: 'PENDING' }, take: 1 },
} satisfies Prisma.ItemAccountingInclude;

type StateRow = Prisma.ItemAccountingGetPayload<{ include: typeof STATE_INCLUDE }>;

const num = (value: bigint | null): number | null => (value === null ? null : Number(value));
const big = (value: number | null): bigint | null => (value === null ? null : BigInt(value));

function toContribution(row: StateRow['contributions'][number]): ContributionRow {
  return {
    id: row.id,
    profileId: row.profileId,
    mode: row.mode,
    share:
      row.shareNum !== null && row.shareDen !== null
        ? { num: row.shareNum, den: row.shareDen }
        : null,
    units: row.units,
    amount: num(row.amountMinor),
    prePurchase: num(row.prePurchaseMinor),
    rank: row.rank,
    settled: Number(row.settledMinor),
    settlement: row.settlement,
    settledAt: row.settledAt,
    settlementNote: row.settlementNote,
    nudgedAt: row.nudgedAt,
    createdAt: row.createdAt,
  };
}

function toPurchase(row: NonNullable<StateRow['purchase']>): PurchaseRow {
  return {
    id: row.id,
    buyerId: row.buyerProfileId,
    purchasedAt: row.purchasedAt,
    planned: num(row.plannedTotalMinor),
    actual: num(row.actualTotalMinor),
    receiptKey: row.receiptKey,
    raiseUntil: row.raiseUntil,
  };
}

function toProposal(value: Prisma.JsonValue): ReviewProposal {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: { total?: number; reviewEnabled?: boolean; receiptEnabled?: boolean } = {};
  if (typeof value.total === 'number') out.total = value.total;
  if (typeof value.reviewEnabled === 'boolean') out.reviewEnabled = value.reviewEnabled;
  if (typeof value.receiptEnabled === 'boolean') out.receiptEnabled = value.receiptEnabled;
  return out;
}

function toReview(row: StateRow['reviews'][number]): ReviewRow {
  return {
    id: row.id,
    kind: row.kind,
    authorId: row.authorProfileId,
    proposed: toProposal(row.proposed),
    status: row.status,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}

function toState(row: StateRow, refusedCost: number | null): AccountingState {
  return {
    id: row.id,
    itemId: row.itemId,
    currency: row.currency,
    planned: num(row.plannedTotalMinor),
    buyerId: row.buyerProfileId,
    reviewEnabled: row.reviewEnabled,
    receiptEnabled: row.receiptEnabled,
    nextRank: row.nextRank,
    detachedTitle: row.detachedTitle,
    detachedEventId: row.detachedEventId,
    detachedAt: row.detachedAt,
    detachedExcluded: row.detachedRecipientIds,
    version: row.version,
    contributions: row.contributions.map(toContribution),
    purchase: row.purchase ? toPurchase(row.purchase) : null,
    reviews: row.reviews.map(toReview),
    refusedCost,
    buyerRequest: row.buyerRequests[0]
      ? {
          id: row.buyerRequests[0].id,
          candidateId: row.buyerRequests[0].candidateProfileId,
          status: row.buyerRequests[0].status,
          decidedBy: row.buyerRequests[0].decidedBy,
          decidedAt: row.buyerRequests[0].decidedAt,
          createdAt: row.buyerRequests[0].createdAt,
        }
      : null,
  };
}

async function load(
  db: Tx | PrismaService,
  where: Prisma.ItemAccountingWhereUniqueInput,
): Promise<AccountingState | null> {
  const row = await db.itemAccounting.findUnique({ where, include: STATE_INCLUDE });
  if (!row) return null;
  const refused = await db.accountingReview.findFirst({
    where: { accountingId: row.id, kind: 'COST', status: 'REFUSED' },
    orderBy: { decidedAt: 'desc' },
    select: { proposed: true },
  });
  return toState(row, refused ? (toProposal(refused.proposed).total ?? null) : null);
}

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/** Dépôt de la compta (ADR 0019) : transaction, clé d'idempotence d'abord, verrou sur la fiche. */
@Injectable()
export class PrismaAccountingRepository extends AccountingRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdGenerator,
  ) {
    super();
  }

  findByItem(itemId: string): Promise<AccountingState | null> {
    return load(this.prisma, { itemId });
  }

  findById(accountingId: string): Promise<AccountingState | null> {
    return load(this.prisma, { id: accountingId });
  }

  async findByPendingReview(reviewId: string): Promise<AccountingState | null> {
    const review = await this.prisma.accountingReview.findFirst({
      where: { id: reviewId, status: 'PENDING' },
      select: { accountingId: true },
    });
    return review ? load(this.prisma, { id: review.accountingId }) : null;
  }

  async findByPendingBuyerRequest(requestId: string): Promise<AccountingState | null> {
    const request = await this.prisma.buyerRequest.findFirst({
      where: { id: requestId, status: 'PENDING' },
      select: { accountingId: true },
    });
    return request ? load(this.prisma, { id: request.accountingId }) : null;
  }

  async findByContribution(contributionId: string): Promise<AccountingState | null> {
    const row = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      select: { accountingId: true },
    });
    return row ? load(this.prisma, { id: row.accountingId }) : null;
  }

  async findByProfile(profileId: string): Promise<AccountingState[]> {
    const rows = await this.prisma.itemAccounting.findMany({
      where: { OR: [{ buyerProfileId: profileId }, { contributions: { some: { profileId } } }] },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const states = await Promise.all(rows.map((row) => load(this.prisma, { id: row.id })));
    return states.filter((state): state is AccountingState => state !== null);
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
    return this.prisma.$transaction(
      async (tx) => {
        const replay = await this.claimKey(tx, input.idempotency);
        if (replay) return { replayed: true, response: replay.response };
        // M1 : la proposition est verrouillée et relue en attente dans la transaction.
        const pending = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "offset_proposal"
           WHERE "id" = ${input.proposal.id}::uuid AND "status" = 'PENDING' FOR UPDATE`;
        if (pending.length === 0) throw new AccountingNotFoundError();
        const states = new Map<string, AccountingState>();
        for (const id of [...new Set(input.accountingIds)].sort()) {
          const state = await this.lock(tx, { accountingId: id });
          if (state) states.set(id, state);
        }
        const result = input.work(states);
        for (const work of result.works) {
          await this.write(
            tx,
            states.get(work.next.id) ?? null,
            work,
            input.actorId,
            input.operationId,
          );
        }
        await tx.offsetProposal.update({
          where: { id: input.proposal.id },
          data: { status: input.proposal.status, decidedAt: new Date() },
        });
        await tx.idempotencyRecord.update({
          where: {
            profileId_key: { profileId: input.idempotency.profileId, key: input.idempotency.key },
          },
          data: { status: result.response.status, response: json(result.response.body) },
        });
        return { replayed: false, response: result.response };
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  }

  async claimDueReminders(now: Date, today: string): Promise<DueReminder[]> {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    // CPT-23 : J+7 après l'achat, réclamé une seule fois par part.
    const seven = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "contribution" c SET "reminded_7_at" = ${now}
        FROM "purchase" p
       WHERE p."accounting_id" = c."accounting_id"
         AND c."settlement" = 'DUE' AND c."reminded_7_at" IS NULL AND p."purchased_at" <= ${weekAgo}
      RETURNING c."id"`;
    // CPT-23 : à la date de l'événement de la liste (ou relevé à la suppression, CPT-73).
    const atEvent = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "contribution" c SET "reminded_event_at" = ${now}
        FROM "item_accounting" a
        LEFT JOIN "list_item" i ON i."id" = a."item_id"
        LEFT JOIN "list" l ON l."id" = i."list_id"
        JOIN "event" e ON e."id" = COALESCE(l."event_id", a."detached_event_id")
       WHERE a."id" = c."accounting_id"
         AND c."settlement" = 'DUE' AND c."reminded_event_at" IS NULL AND e."date" <= ${today}::date
      RETURNING c."id"`;
    const ids = [...new Set([...seven, ...atEvent].map((row) => row.id))];
    if (ids.length === 0) return [];
    const rows = await this.prisma.contribution.findMany({
      where: { id: { in: ids } },
      select: {
        profileId: true,
        accounting: {
          select: {
            id: true,
            itemId: true,
            buyerProfileId: true,
            contributions: { select: { profileId: true } },
          },
        },
      },
    });
    return rows.flatMap((row) =>
      row.profileId
        ? [
            {
              accountingId: row.accounting.id,
              itemId: row.accounting.itemId,
              participantId: row.profileId,
              participantIds: row.accounting.contributions.flatMap((c) =>
                c.profileId ? [c.profileId] : [],
              ),
              buyerId: row.accounting.buyerProfileId,
            },
          ]
        : [],
    );
  }

  async shortfallsAfterEvent(today: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a."id" FROM "item_accounting" a
        JOIN "purchase" p ON p."accounting_id" = a."id"
        LEFT JOIN "list_item" i ON i."id" = a."item_id"
        LEFT JOIN "list" l ON l."id" = i."list_id"
        JOIN "event" e ON e."id" = COALESCE(l."event_id", a."detached_event_id")
       WHERE e."date" < ${today}::date
         AND COALESCE(p."actual_total_minor", p."planned_total_minor") >
             (SELECT COALESCE(SUM(c."amount_minor"), 0) FROM "contribution" c WHERE c."accounting_id" = a."id")`;
    return rows.map((row) => row.id);
  }

  async createOffset(proposal: OffsetProposal): Promise<void> {
    await this.prisma.offsetProposal.create({
      data: {
        id: proposal.id,
        proposerProfileId: proposal.proposerId,
        counterpartProfileId: proposal.counterpartId,
        currency: proposal.currency,
        snapshot: json(proposal.snapshot),
        status: proposal.status,
        createdAt: proposal.createdAt,
      },
    });
  }

  async findOffset(id: string): Promise<OffsetProposal | null> {
    const row = await this.prisma.offsetProposal.findUnique({ where: { id } });
    return row ? toOffset(row) : null;
  }

  async pendingOffset(a: string, b: string, currency: string): Promise<OffsetProposal | null> {
    const row = await this.prisma.offsetProposal.findFirst({
      where: {
        status: 'PENDING',
        currency,
        OR: [
          { proposerProfileId: a, counterpartProfileId: b },
          { proposerProfileId: b, counterpartProfileId: a },
        ],
      },
    });
    return row ? toOffset(row) : null;
  }

  async setOffsetStatus(id: string, status: OffsetStatus, at: Date): Promise<void> {
    await this.prisma.offsetProposal.update({ where: { id }, data: { status, decidedAt: at } });
  }

  async findByBuyer(profileId: string): Promise<AccountingState[]> {
    const rows = await this.prisma.itemAccounting.findMany({
      where: { buyerProfileId: profileId },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const states = await Promise.all(rows.map((row) => load(this.prisma, { id: row.id })));
    return states.filter((state): state is AccountingState => state !== null);
  }

  mutate(input: {
    readonly key: AccountingKey;
    readonly actorId: string | null;
    readonly operationId: string;
    readonly idempotency: IdempotencyInput | null;
    readonly work: (state: AccountingState | null) => AccountingWork;
  }): Promise<MutateResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const idem = input.idempotency;
        const replay = idem ? await this.claimKey(tx, idem) : null;
        if (replay) return replay;
        const prev = await this.lock(tx, input.key);
        const work = input.work(prev);
        const state = await this.write(tx, prev, work, input.actorId, input.operationId);
        if (idem) {
          await tx.idempotencyRecord.update({
            where: { profileId_key: { profileId: idem.profileId, key: idem.key } },
            data: { status: work.response.status, response: json(work.response.body) },
          });
        }
        return { replayed: false as const, state, response: work.response };
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  }

  /**
   * CPT-71 : la clé est insérée avant tout effet. Une requête concurrente avec la même clé attend
   * sur l'index unique, puis lit la réponse enregistrée. Une clé échue est reprise.
   */
  private async claimKey(tx: Tx, idem: IdempotencyInput): Promise<MutateResult | null> {
    const now = new Date();
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "idempotency_record" ("id", "profile_id", "key", "request_hash", "status", "response", "expires_at")
      VALUES (${this.ids.next()}::uuid, ${idem.profileId}::uuid, ${idem.key}, ${idem.requestHash}, 0, '{}'::jsonb,
              ${new Date(now.getTime() + IDEMPOTENCY_TTL_MS)})
      ON CONFLICT ("profile_id", "key") DO NOTHING
      RETURNING "id"`;
    if (inserted.length > 0) return null;
    const existing = await tx.idempotencyRecord.findUniqueOrThrow({
      where: { profileId_key: { profileId: idem.profileId, key: idem.key } },
    });
    if (existing.expiresAt.getTime() <= now.getTime()) {
      await tx.idempotencyRecord.update({
        where: { id: existing.id },
        data: {
          requestHash: idem.requestHash,
          status: 0,
          response: {},
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
        },
      });
      return null;
    }
    if (existing.requestHash !== idem.requestHash) throw new IdempotencyKeyReusedError();
    return { replayed: true, response: { status: existing.status, body: existing.response } };
  }

  /** Verrou sur la fiche ; pour l'ouvrir, verrou sur l'élément d'abord (deux premières parts). */
  /**
   * Revue SEC-40, I1 : un seul ordre de verrous, l'élément puis la fiche, comme la suppression d'un
   * élément (dont le déclencheur verrouille la fiche après la ligne `list_item`).
   */
  private async lock(tx: Tx, key: AccountingKey): Promise<AccountingState | null> {
    if ('accountingId' in key) {
      const head = await tx.itemAccounting.findUnique({
        where: { id: key.accountingId },
        select: { itemId: true },
      });
      if (head?.itemId) {
        await tx.$queryRaw`SELECT "id" FROM "list_item" WHERE "id" = ${head.itemId}::uuid FOR UPDATE`;
      }
      await tx.$queryRaw`SELECT "id" FROM "item_accounting" WHERE "id" = ${key.accountingId}::uuid FOR UPDATE`;
      return load(tx, { id: key.accountingId });
    }
    await tx.$queryRaw`SELECT "id" FROM "list_item" WHERE "id" = ${key.itemId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "item_accounting" WHERE "item_id" = ${key.itemId}::uuid FOR UPDATE`;
    return load(tx, { itemId: key.itemId });
  }

  private async write(
    tx: Tx,
    prev: AccountingState | null,
    work: AccountingWork,
    actorId: string | null,
    operationId: string,
  ): Promise<AccountingState> {
    const { next, diff } = work;
    const header = {
      currency: next.currency,
      plannedTotalMinor: big(next.planned),
      buyerProfileId: next.buyerId,
      reviewEnabled: next.reviewEnabled,
      receiptEnabled: next.receiptEnabled,
      nextRank: next.nextRank,
    };
    if (!prev) {
      await tx.itemAccounting.create({ data: { id: next.id, itemId: next.itemId, ...header } });
    } else if (diff.ledger.length > 0) {
      await tx.itemAccounting.update({
        where: { id: next.id },
        data: { ...header, version: { increment: 1 } },
      });
    }
    if (diff.contributions.remove.length > 0) {
      await tx.contribution.deleteMany({ where: { id: { in: diff.contributions.remove } } });
    }
    // Rangs uniques : les lignes modifiées d'abord, les nouvelles ensuite.
    for (const row of diff.contributions.upsert) {
      const data = {
        profileId: row.profileId,
        mode: row.mode,
        shareNum: row.share?.num ?? null,
        shareDen: row.share?.den ?? null,
        units: row.units,
        amountMinor: big(row.amount),
        prePurchaseMinor: big(row.prePurchase),
        rank: row.rank,
        settledMinor: BigInt(row.settled),
        settlement: row.settlement,
        settledAt: row.settledAt,
        settlementNote: row.settlementNote,
        nudgedAt: row.nudgedAt,
      };
      await tx.contribution.upsert({
        where: { id: row.id },
        create: { id: row.id, accountingId: next.id, createdAt: row.createdAt, ...data },
        update: data,
      });
    }
    if (diff.purchase.remove) await tx.purchase.delete({ where: { id: diff.purchase.remove } });
    if (diff.purchase.upsert) {
      const p = diff.purchase.upsert;
      const data = {
        buyerProfileId: p.buyerId,
        purchasedAt: p.purchasedAt,
        plannedTotalMinor: big(p.planned),
        actualTotalMinor: big(p.actual),
        receiptKey: p.receiptKey,
        raiseUntil: p.raiseUntil,
      };
      await tx.purchase.upsert({
        where: { id: p.id },
        create: { id: p.id, accountingId: next.id, ...data },
        update: data,
      });
    }
    for (const review of diff.reviews.upsert) {
      const data = {
        kind: review.kind,
        authorProfileId: review.authorId,
        proposed: json(review.proposed),
        status: review.status,
        decidedBy: review.decidedBy,
        decidedAt: review.decidedAt,
      };
      await tx.accountingReview.upsert({
        where: { id: review.id },
        create: { id: review.id, accountingId: next.id, createdAt: review.createdAt, ...data },
        update: data,
      });
    }
    for (const request of diff.buyerRequests.upsert) {
      const data = {
        candidateProfileId: request.candidateId,
        status: request.status,
        decidedBy: request.decidedBy,
        decidedAt: request.decidedAt,
      };
      await tx.buyerRequest.upsert({
        where: { id: request.id },
        create: { id: request.id, accountingId: next.id, createdAt: request.createdAt, ...data },
        update: data,
      });
    }
    if (work.notice) {
      await tx.shortfallNotice.create({
        data: {
          id: work.notice.id,
          accountingId: next.id,
          authorProfileId: work.notice.authorId,
          amountMinor: BigInt(work.notice.amount),
          notifiedProfileIds: [...work.notice.notifiedIds],
        },
      });
    }
    if (diff.ledger.length > 0) {
      await tx.ledgerEntry.createMany({
        data: diff.ledger.map((draft) => ({
          id: this.ids.next(),
          accountingId: next.id,
          actorProfileId: actorId,
          kind: draft.kind,
          targetId: draft.targetId,
          before: draft.before === null ? Prisma.DbNull : json(draft.before),
          after: draft.after === null ? Prisma.DbNull : json(draft.after),
          operationId,
        })),
      });
    }
    // LST-11, LST-12 : l'état réel de l'élément suit la compta, sans toucher sa version (VIS-35).
    if (next.itemId) {
      const status = itemStatusOf(next);
      await tx.$executeRaw`
        UPDATE "list_item" SET "status" = ${status}::"item_status"
         WHERE "id" = ${next.itemId}::uuid AND "status" <> 'WITHDRAWN' AND "status" <> ${status}::"item_status"`;
    }
    return (await load(tx, { id: next.id })) ?? next;
  }
}

@Injectable()
export class PrismaAccountingPeople extends AccountingPeople {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async cards(profileIds: readonly string[]): Promise<PersonCard[]> {
    if (profileIds.length === 0) return [];
    return this.prisma.profile.findMany({
      where: { id: { in: [...new Set(profileIds)] } },
      select: { id: true, displayName: true, avatar: true, accentColor: true },
    });
  }
}

function toOffset(row: Prisma.OffsetProposalGetPayload<object>): OffsetProposal {
  const snapshot = Array.isArray(row.snapshot)
    ? row.snapshot.flatMap((entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        typeof entry.contributionId === 'string' &&
        typeof entry.owed === 'number'
          ? [{ contributionId: entry.contributionId, owed: entry.owed }]
          : [],
      )
    : [];
  return {
    id: row.id,
    proposerId: row.proposerProfileId,
    counterpartId: row.counterpartProfileId,
    currency: row.currency,
    snapshot,
    status: row.status,
    createdAt: row.createdAt,
  };
}

/** CPT-40, CPT-69 : budgets privés. */
@Injectable()
export class PrismaBudgetRepository extends BudgetRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(profileId: string, eventId: string | null): Promise<BudgetRecord[]> {
    const rows = await this.prisma.budget.findMany({
      where: { profileId, ...(eventId ? { eventId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toBudget);
  }

  async upsert(budget: BudgetRecord): Promise<BudgetRecord> {
    const existing = await this.prisma.budget.findFirst({
      where: {
        profileId: budget.profileId,
        eventId: budget.eventId,
        recipientProfileId: budget.recipientId,
      },
    });
    const data = { amountMinor: BigInt(budget.amountMinor), currency: budget.currency };
    const row = existing
      ? await this.prisma.budget.update({ where: { id: existing.id }, data })
      : await this.prisma.budget.create({
          data: {
            id: budget.id,
            profileId: budget.profileId,
            eventId: budget.eventId,
            recipientProfileId: budget.recipientId,
            ...data,
          },
        });
    return toBudget(row);
  }

  async delete(profileId: string, id: string): Promise<boolean> {
    const result = await this.prisma.budget.deleteMany({ where: { id, profileId } });
    return result.count > 0;
  }
}

function toBudget(row: Prisma.BudgetGetPayload<object>): BudgetRecord {
  return {
    id: row.id,
    profileId: row.profileId,
    eventId: row.eventId,
    recipientId: row.recipientProfileId,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
  };
}
