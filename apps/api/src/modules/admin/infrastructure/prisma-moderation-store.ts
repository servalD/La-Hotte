import { Injectable } from '@nestjs/common';
import { Prisma, type ModerationDecision as DecisionRow } from '@prisma/client';
import { appendAudit } from '../../../platform/prisma/audit-writer';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import {
  type DecisionOnMyContent,
  type DecisionRecord,
  type ModerationDecisionKind,
  ModerationStore,
  type ModerationTarget,
  type NewReport,
  type OpenContest,
  type OpenReports,
  type ReportReason,
} from '../domain/moderation';

const NOTES_SHOWN = 10;

function toDecision(row: DecisionRow): DecisionRecord {
  return {
    id: row.id,
    target: { kind: row.targetKind, id: row.targetId },
    action: row.action,
    reason: row.reason,
    actorAccountId: row.actorAccountId,
    parentId: row.parentId,
    at: row.at,
  };
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Signalements et décisions (MOD-07 à MOD-11), décision et audit dans une transaction (AUD-05). */
/**
 * MOD-10, MOD-11 (revue SEC-40, cycle 3, I2) : cible encore lisible, pour que les signalements et
 * contestations d'un contenu supprimé (message, élément, liste ou fiche) n'occupent pas la file,
 * dont la taille est bornée. Alias de table fixé par l'appelant, jamais une donnée d'utilisateur.
 */
const LIVE_TARGET = (alias: 'r' | 'd') =>
  Prisma.sql`((${Prisma.raw(alias)}.target_kind = 'COMMENT' AND EXISTS (
      SELECT 1 FROM comment cm WHERE cm.id = ${Prisma.raw(alias)}.target_id AND cm.deleted_at IS NULL))
    OR (${Prisma.raw(alias)}.target_kind = 'PRODUCT' AND EXISTS (
      SELECT 1 FROM product pd WHERE pd.id = ${Prisma.raw(alias)}.target_id)))`;

@Injectable()
export class PrismaModerationStore extends ModerationStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async addReport(report: NewReport): Promise<{ created: boolean; distinctAccounts: number }> {
    let created = true;
    try {
      await this.prisma.report.create({
        data: {
          id: report.id,
          reporterProfileId: report.reporterProfileId,
          reporterAccountId: report.reporterAccountId,
          targetKind: report.target.kind,
          targetId: report.target.id,
          reason: report.reason,
          note: report.note,
          createdAt: report.at,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      created = false;
    }
    const [row] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT reporter_account_id)::int AS n FROM report
      WHERE target_kind = ${report.target.kind}::report_target_kind
        AND target_id = ${report.target.id}::uuid AND status = 'OPEN'`;
    return { created, distinctAccounts: row?.n ?? 0 };
  }

  private async summarize(target: ModerationTarget, firstAt: Date): Promise<OpenReports> {
    const rows = await this.prisma.report.findMany({
      where: { targetKind: target.kind, targetId: target.id, status: 'OPEN' },
      select: { reason: true, note: true },
      orderBy: { createdAt: 'asc' },
    });
    const counts = new Map<ReportReason, number>();
    for (const row of rows) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
    return {
      target,
      reasons: [...counts].map(([reason, count]) => ({ reason, count })),
      notes: rows.flatMap((row) => (row.note ? [row.note] : [])).slice(0, NOTES_SHOWN),
      firstAt,
    };
  }

  async openReports(limit: number): Promise<OpenReports[]> {
    const targets = await this.prisma.$queryRaw<
      { target_kind: ModerationTarget['kind']; target_id: string; first_at: Date }[]
    >`
      SELECT r.target_kind, r.target_id, MIN(r.created_at) AS first_at FROM report r
      WHERE r.status = 'OPEN' AND ${LIVE_TARGET('r')}
      GROUP BY r.target_kind, r.target_id
      ORDER BY first_at, r.target_id LIMIT ${limit}`;
    return Promise.all(
      targets.map((t) => this.summarize({ kind: t.target_kind, id: t.target_id }, t.first_at)),
    );
  }

  async openReportsOn(target: ModerationTarget): Promise<OpenReports | null> {
    const first = await this.prisma.report.findFirst({
      where: { targetKind: target.kind, targetId: target.id, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return first ? this.summarize(target, first.createdAt) : null;
  }

  async record(input: {
    decision: DecisionRecord;
    audit: Parameters<typeof appendAudit>[1];
    closeReports: boolean;
    expectedLastDecisionId?: string | null;
  }): Promise<boolean> {
    const { decision } = input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Une décision à la fois par cible : verrou de transaction, puis relecture (I3, SEC-40).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`moderation:${decision.target.kind}:${decision.target.id}`}, 0))`;
        if (input.expectedLastDecisionId !== undefined) {
          const last = await lastDecision(tx, decision.target);
          if (last !== input.expectedLastDecisionId) return false;
        }
        await tx.moderationDecision.create({
          data: {
            id: decision.id,
            targetKind: decision.target.kind,
            targetId: decision.target.id,
            action: decision.action,
            reason: decision.reason,
            actorAccountId: decision.actorAccountId,
            parentId: decision.parentId,
            at: decision.at,
          },
        });
        if (input.closeReports) {
          await tx.report.updateMany({
            where: {
              targetKind: decision.target.kind,
              targetId: decision.target.id,
              status: 'OPEN',
            },
            data: { status: 'DECIDED', decidedAt: decision.at },
          });
        }
        await appendAudit(tx, input.audit);
        return true;
      });
    } catch (error) {
      // MOD-11 : une seule réponse par contestation (index unique).
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  lastDecisionOn(target: ModerationTarget): Promise<string | null> {
    return lastDecision(this.prisma, target);
  }

  async findDecision(id: string): Promise<DecisionRecord | null> {
    const row = await this.prisma.moderationDecision.findUnique({ where: { id } });
    return row ? toDecision(row) : null;
  }

  async contest(contest: DecisionRecord): Promise<'created' | 'already'> {
    try {
      await this.prisma.moderationDecision.create({
        data: {
          id: contest.id,
          targetKind: contest.target.kind,
          targetId: contest.target.id,
          action: 'CONTEST',
          reason: contest.reason,
          actorAccountId: contest.actorAccountId,
          parentId: contest.parentId,
          at: contest.at,
        },
      });
      return 'created';
    } catch (error) {
      if (isUniqueViolation(error)) return 'already';
      throw error;
    }
  }

  async openContests(limit: number): Promise<OpenContest[]> {
    // Revue SEC-40 (cycle 3, I2) : une contestation dont la cible a disparu, soustraite à tous,
    // n'occupe pas la file : seules les cibles vivantes y entrent.
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT d.id FROM moderation_decision d
      WHERE d.action = 'CONTEST'
        AND NOT EXISTS (SELECT 1 FROM moderation_decision c WHERE c.parent_id = d.id)
        AND ${LIVE_TARGET('d')}
      ORDER BY d.at, d.id LIMIT ${limit}`;
    if (ids.length === 0) return [];
    const rows = await this.prisma.moderationDecision.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      include: { parent: true },
      orderBy: [{ at: 'asc' }, { id: 'asc' }],
    });
    return rows.flatMap((row) =>
      row.parent ? [{ contest: toDecision(row), decision: toDecision(row.parent) }] : [],
    );
  }

  async contestOpen(contestId: string): Promise<boolean> {
    const row = await this.prisma.moderationDecision.findFirst({
      where: { id: contestId, action: 'CONTEST', children: { none: {} } },
      select: { id: true },
    });
    return row !== null;
  }

  async decisionsOnContentOf(profileId: string): Promise<DecisionOnMyContent[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        target_kind: ModerationTarget['kind'];
        target_id: string;
        action: ModerationDecisionKind;
        reason: string;
        at: Date;
        contest_id: string | null;
        outcome: ModerationDecisionKind | null;
      }[]
    >`
      SELECT d.id, d.target_kind, d.target_id, d.action, d.reason, d.at,
             k.id AS contest_id, r.action AS outcome
      FROM moderation_decision d
      LEFT JOIN product p ON d.target_kind = 'PRODUCT' AND p.id = d.target_id
      LEFT JOIN comment c ON d.target_kind = 'COMMENT' AND c.id = d.target_id
      LEFT JOIN moderation_decision k ON k.parent_id = d.id AND k.action = 'CONTEST'
      LEFT JOIN moderation_decision r ON r.parent_id = k.id
      WHERE d.parent_id IS NULL
        AND d.action IN ('REMOVE', 'REMOVE_AND_SUSPEND')
        AND (p.owner_profile_id = ${profileId}::uuid OR c.author_profile_id = ${profileId}::uuid)
      ORDER BY d.at DESC LIMIT 50`;
    return rows.map((row) => ({
      id: row.id,
      target: { kind: row.target_kind, id: row.target_id },
      action: row.action,
      reason: row.reason,
      at: row.at,
      contested: row.contest_id !== null,
      contestOutcome: row.outcome === null ? null : row.outcome === 'KEEP' ? 'OVERTURN' : 'UPHOLD',
    }));
  }

  async commentsToErase(before: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT c.id
      FROM moderation_decision d
      JOIN comment c ON c.id = d.target_id
      WHERE d.target_kind = 'COMMENT' AND d.parent_id IS NULL
        AND d.action IN ('REMOVE', 'REMOVE_AND_SUSPEND') AND d.at < ${before}
        AND c.moderated_at IS NOT NULL AND c.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM moderation_decision k
          WHERE k.parent_id = d.id AND k.action = 'CONTEST'
            AND NOT EXISTS (SELECT 1 FROM moderation_decision r WHERE r.parent_id = k.id)
        )
      LIMIT 500`;
    return rows.map((row) => row.id);
  }
}

async function lastDecision(
  db: Pick<PrismaService, 'moderationDecision'>,
  target: ModerationTarget,
): Promise<string | null> {
  const row = await db.moderationDecision.findFirst({
    where: { targetKind: target.kind, targetId: target.id, parentId: null },
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  return row?.id ?? null;
}
