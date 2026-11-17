import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IdGenerator } from '../../../shared/domain';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { IdempotencyKeyReusedError } from '../domain/accounting.errors';
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
  private async lock(tx: Tx, key: AccountingKey): Promise<AccountingState | null> {
    if ('accountingId' in key) {
      await tx.$queryRaw`SELECT "id" FROM "item_accounting" WHERE "id" = ${key.accountingId}::uuid FOR UPDATE`;
      return load(tx, { id: key.accountingId });
    }
    const found = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "item_accounting" WHERE "item_id" = ${key.itemId}::uuid FOR UPDATE`;
    if (found.length === 0) {
      await tx.$queryRaw`SELECT "id" FROM "list_item" WHERE "id" = ${key.itemId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "item_accounting" WHERE "item_id" = ${key.itemId}::uuid FOR UPDATE`;
    }
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
