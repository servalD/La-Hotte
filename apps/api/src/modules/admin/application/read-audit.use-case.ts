import { Injectable } from '@nestjs/common';
import { type AuditAction, Clock, IdGenerator } from '../../../shared/domain';
import { AuditCursorInvalidError } from '../domain/admin.errors';
import {
  AUDIT_PAGE_MAX,
  type AuditRecord,
  AuditTrail,
  decodeAuditCursor,
  encodeAuditCursor,
} from '../domain/audit-trail';

export interface AuditPage {
  readonly items: readonly AuditRecord[];
  readonly nextCursor: string | null;
}

/** AUD-04, AUD-06 : consultation du journal, elle-même journalisée. */
@Injectable()
export class ReadAudit {
  constructor(
    private readonly trail: AuditTrail,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly actorAccountId: string;
    readonly ip: string;
    readonly filterActorAccountId: string | null;
    readonly action: AuditAction | null;
    readonly from: Date | null;
    readonly to: Date | null;
    readonly cursor: string | null;
    readonly limit: number | null;
  }): Promise<AuditPage> {
    const before = input.cursor ? decodeAuditCursor(input.cursor) : null;
    if (input.cursor && !before) throw new AuditCursorInvalidError();
    const limit = Math.min(Math.max(input.limit ?? AUDIT_PAGE_MAX, 1), AUDIT_PAGE_MAX);
    const rows = await this.trail.consult({
      id: this.ids.next(),
      at: this.clock.now(),
      entry: {
        actorAccountId: input.actorAccountId,
        action: 'audit.read',
        targetKind: null,
        targetId: null,
        reason: null,
        ip: input.ip,
      },
      filter: {
        actorAccountId: input.filterActorAccountId,
        action: input.action,
        from: input.from,
        to: input.to,
        before,
        limit: limit + 1,
      },
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last ? encodeAuditCursor(last) : null,
    };
  }
}
