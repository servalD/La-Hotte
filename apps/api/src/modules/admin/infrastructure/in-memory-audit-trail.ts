import type { AuditEntry } from '../../../shared/domain';
import { type AuditFilter, type AuditRecord, AuditTrail } from '../domain/audit-trail';

/** Double en mémoire ; `failNext` simule une écriture d'audit qui échoue (AUD-05). */
export class InMemoryAuditTrail extends AuditTrail {
  readonly rows: AuditRecord[] = [];
  failNext = false;

  /** Écrit une entrée, comme le ferait la transaction d'une action ; lève si `failNext`. */
  append(input: { readonly id: string; readonly at: Date; readonly entry: AuditEntry }): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('écriture d’audit refusée');
    }
    const { entry } = input;
    this.rows.push({
      id: input.id,
      at: input.at,
      actorAccountId: entry.actorAccountId,
      action: entry.action,
      targetKind: entry.targetKind,
      targetId: entry.targetId,
      reason: entry.reason,
      ip: entry.ip,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
  }

  consult(input: Parameters<AuditTrail['consult']>[0]): Promise<AuditRecord[]> {
    try {
      this.append(input);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('audit'));
    }
    return this.read(input.filter);
  }

  read(filter: AuditFilter): Promise<AuditRecord[]> {
    const rows = this.rows
      .filter((r) => !filter.actorAccountId || r.actorAccountId === filter.actorAccountId)
      .filter((r) => !filter.action || r.action === filter.action)
      .filter((r) => !filter.from || r.at >= filter.from)
      .filter((r) => !filter.to || r.at <= filter.to)
      .filter(
        (r) =>
          !filter.before ||
          r.at < filter.before.at ||
          (r.at.getTime() === filter.before.at.getTime() && r.id < filter.before.id),
      )
      .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
    return Promise.resolve(rows.slice(0, filter.limit));
  }
}
