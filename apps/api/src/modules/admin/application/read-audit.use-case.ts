import { Injectable } from '@nestjs/common';
import { type AuditAction, Clock, IdGenerator } from '../../../shared/domain';
import { AuditCursorInvalidError } from '../domain/admin.errors';
import {
  AUDIT_PAGE_MAX,
  type AuditCursor,
  type AuditFilter,
  type AuditRecord,
  AuditTrail,
  decodeAuditCursor,
  encodeAuditCursor,
} from '../domain/audit-trail';
import { type ModerationActor, ModerationTargets } from './moderate-content.use-case';

export interface AuditPage {
  readonly items: readonly AuditRecord[];
  readonly nextCursor: string | null;
}

/**
 * ADM-05 (revue SEC-40, m1) : entrées lues par tranche (4 pages), et tranches lues au plus, pour
 * remplir une page malgré les entrées soustraites. Au-delà (40 pages d'entrées soustraites
 * d'affilée), la page sort incomplète avec un curseur : seuil assumé, écrit dans AUD-06.
 */
const AUDIT_READ_WINDOW = 4;
const AUDIT_READ_ROUNDS = 10;

type Standing = 'visible' | 'withheld' | 'gone';

/** AUD-04, AUD-06 : consultation du journal, elle-même journalisée. */
@Injectable()
export class ReadAudit {
  constructor(
    private readonly trail: AuditTrail,
    private readonly targets: ModerationTargets,
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
    const window = limit * AUDIT_READ_WINDOW;
    const filter = (after: AuditCursor | null): AuditFilter => ({
      actorAccountId: input.filterActorAccountId,
      action: input.action,
      from: input.from,
      to: input.to,
      before: after,
      limit: window + 1,
    });
    // AUD-04 : la première lecture écrit l'entrée de la consultation ; les suivantes la prolongent.
    let rows = await this.trail.consult({
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
      filter: filter(before),
    });
    const actor = await this.targets.actor(input.actorAccountId);
    const standings = new Map<string, Standing>();
    const items: AuditRecord[] = [];
    for (let round = 1; ; round += 1) {
      const scanned = rows.slice(0, window);
      let last: AuditRecord | null = null;
      for (const row of scanned) {
        if (items.length === limit) break;
        const kept = await this.keep(actor, row, standings);
        if (kept) items.push(kept);
        last = row;
      }
      if (items.length === limit) {
        // Page pleine : on reprend après sa dernière entrée, s'il reste quelque chose à lire.
        const more = rows.length > window || last !== scanned.at(-1);
        return { items, nextCursor: more ? encodeAuditCursor(items.at(-1) as AuditRecord) : null };
      }
      if (rows.length <= window || !last) return { items, nextCursor: null };
      if (round >= AUDIT_READ_ROUNDS) return { items, nextCursor: encodeAuditCursor(last) };
      rows = await this.trail.read(filter(last));
    }
  }

  /**
   * ADM-05, RBAC-12 (revue SEC-40, M1 puis I2) : une entrée sur un contenu qui concerne un profil
   * du lecteur, aujourd'hui ou à une décision passée, ou que son compte a signalé, lui est
   * soustraite sans marqueur, comme dans sa file. Le motif d'une entrée dont la cible a disparu
   * n'est rendu à personne : plus rien ne permet de juger qui elle concernait.
   */
  private async keep(
    actor: ModerationActor,
    row: AuditRecord,
    standings: Map<string, Standing>,
  ): Promise<AuditRecord | null> {
    if ((row.targetKind !== 'PRODUCT' && row.targetKind !== 'COMMENT') || !row.targetId) {
      return row;
    }
    const key = `${row.targetKind}:${row.targetId}`;
    let standing = standings.get(key);
    if (!standing) {
      standing = await this.targets.standing(actor, { kind: row.targetKind, id: row.targetId });
      standings.set(key, standing);
    }
    if (standing === 'withheld') return null;
    return standing === 'gone' ? { ...row, reason: null } : row;
  }
}
