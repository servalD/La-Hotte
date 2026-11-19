import { Injectable } from '@nestjs/common';
import type { AuditLog, Prisma } from '@prisma/client';
import { appendAudit } from '../../../platform/prisma/audit-writer';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import type { AuditAction, AuditTargetKind, AuditValue } from '../../../shared/domain';
import { type AuditFilter, type AuditRecord, AuditTrail } from '../domain/audit-trail';

function toRecord(row: AuditLog): AuditRecord {
  return {
    id: row.id,
    at: row.at,
    actorAccountId: row.actorAccountId,
    action: row.action as AuditAction,
    targetKind: row.targetKind as AuditTargetKind | null,
    targetId: row.targetId,
    reason: row.reason,
    ip: row.ip,
    before: (row.before ?? null) as AuditValue,
    after: (row.after ?? null) as AuditValue,
  };
}

function whereOf(filter: AuditFilter): Prisma.AuditLogWhereInput {
  const { before } = filter;
  const at: Prisma.DateTimeFilter = {
    ...(filter.from ? { gte: filter.from } : {}),
    ...(filter.to ? { lte: filter.to } : {}),
  };
  return {
    ...(filter.actorAccountId ? { actorAccountId: filter.actorAccountId } : {}),
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.from || filter.to ? { at } : {}),
    ...(before
      ? { OR: [{ at: { lt: before.at } }, { at: before.at, id: { lt: before.id } }] }
      : {}),
  };
}

/** AUD-04, AUD-05 : l'entrée de la consultation et la lecture dans la même transaction. */
@Injectable()
export class PrismaAuditTrail extends AuditTrail {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  consult(input: Parameters<AuditTrail['consult']>[0]): Promise<AuditRecord[]> {
    return this.prisma.$transaction(async (tx) => {
      await appendAudit(tx, input);
      const rows = await tx.auditLog.findMany({
        where: whereOf(input.filter),
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take: input.filter.limit,
      });
      return rows.map(toRecord);
    });
  }

  async read(filter: AuditFilter): Promise<AuditRecord[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: whereOf(filter),
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: filter.limit,
    });
    return rows.map(toRecord);
  }
}
