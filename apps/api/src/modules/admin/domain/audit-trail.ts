import type { AuditAction, AuditEntry, AuditTargetKind, AuditValue } from '../../../shared/domain';

/** Une entrée du journal, telle que l'administrateur la consulte (AUD-06). */
export interface AuditRecord {
  readonly id: string;
  readonly at: Date;
  readonly actorAccountId: string | null;
  readonly action: AuditAction;
  readonly targetKind: AuditTargetKind | null;
  readonly targetId: string | null;
  readonly reason: string | null;
  readonly ip: string | null;
  readonly before: AuditValue;
  readonly after: AuditValue;
}

export interface AuditCursor {
  readonly at: Date;
  readonly id: string;
}

/** AUD-06 : filtres de la consultation, du plus récent au plus ancien. */
export interface AuditFilter {
  readonly actorAccountId: string | null;
  readonly action: AuditAction | null;
  readonly from: Date | null;
  readonly to: Date | null;
  readonly before: AuditCursor | null;
  readonly limit: number;
}

export const AUDIT_PAGE_MAX = 50;

export abstract class AuditTrail {
  /**
   * AUD-04, AUD-05 : écrit l'entrée de la consultation puis lit la page, dans une transaction ;
   * si l'écriture échoue, rien n'est lu.
   */
  abstract consult(input: {
    readonly id: string;
    readonly at: Date;
    readonly entry: AuditEntry;
    readonly filter: AuditFilter;
  }): Promise<AuditRecord[]>;
}

export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeAuditCursor(value: string): AuditCursor | null {
  const [raw, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  if (!raw || !id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : { at, id };
}
