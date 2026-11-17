import { Prisma } from '@prisma/client';
import type { AuditEntry, AuditValue } from '../../shared/domain';

const json = (value: AuditValue | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  value === undefined || value === null ? Prisma.DbNull : value;

/**
 * AUD-05 : écrit l'entrée dans la transaction de l'action. Un dépôt qui exécute une action
 * d'administration l'appelle avec son propre `tx` : si l'écriture échoue, l'action est annulée.
 */
export async function appendAudit(
  tx: Prisma.TransactionClient,
  input: { readonly id: string; readonly at: Date; readonly entry: AuditEntry },
): Promise<void> {
  const { entry } = input;
  await tx.auditLog.create({
    data: {
      id: input.id,
      at: input.at,
      actorAccountId: entry.actorAccountId,
      action: entry.action,
      targetKind: entry.targetKind,
      targetId: entry.targetId,
      reason: entry.reason,
      ip: entry.ip,
      before: json(entry.before),
      after: json(entry.after),
    },
  });
}
