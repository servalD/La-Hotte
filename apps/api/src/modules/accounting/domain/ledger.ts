/**
 * Journal de compta (CPT-50, CPT-70). Chaque écriture porte l'état d'une ligne avant et après
 * l'opération ; rejouer les écritures d'une fiche jusqu'à une date redonne l'état de chaque
 * ligne à cette date. `after` absent : la ligne n'existe plus (participation retirée, achat
 * décoché).
 */

/** Genres d'écriture : liste fermée. */
export const LEDGER_KINDS = [
  'ACCOUNTING_OPENED',
  'ACCOUNTING_UPDATED',
  'ACCOUNTING_COST',
  'ACCOUNTING_OPTIONS',
  'ACCOUNTING_BUYER',
  'CONTRIBUTION_SET',
  'CONTRIBUTION_REMOVED',
  'CONTRIBUTION_ADJUSTED',
  'CONTRIBUTION_LOWERED',
  'PURCHASE_SET',
  'PURCHASE_REMOVED',
  'RECEIPT_SET',
  'REVIEW_OPENED',
  'REVIEW_DECIDED',
  'BUYER_REQUEST_OPENED',
  'BUYER_REQUEST_DECIDED',
  'SHORTFALL_NOTICE',
  'SHORTFALL_ABSORBED',
  'SETTLEMENT_SET',
  'SETTLEMENT_CLAIMED',
  'SETTLEMENT_OFFSET',
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export type Snapshot = Readonly<Record<string, unknown>>;

export interface LedgerRecord {
  readonly id: string;
  readonly kind: LedgerKind;
  /** Ligne touchée (fiche, participation, achat, demande…). */
  readonly targetId: string;
  readonly before: Snapshot | null;
  readonly after: Snapshot | null;
  readonly at: Date;
}

/** Ordre du journal : date, puis identifiant (UUID v7, croissant à l'insertion). */
const chronological = (a: LedgerRecord, b: LedgerRecord) =>
  a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** CPT-70 : état de chaque ligne à la date `until` (incluse). */
export function replay(entries: readonly LedgerRecord[], until?: Date): Map<string, Snapshot> {
  const state = new Map<string, Snapshot>();
  const ordered = [...entries].sort(chronological);
  for (const entry of ordered) {
    if (until && entry.at.getTime() > until.getTime()) break;
    if (entry.after === null) state.delete(entry.targetId);
    else state.set(entry.targetId, entry.after);
  }
  return state;
}

/**
 * Cohérence du journal : chaque écriture part de l'état laissé par la précédente sur la même
 * ligne. Rend les identifiants des écritures qui ne s'enchaînent pas.
 */
export function brokenChain(entries: readonly LedgerRecord[]): string[] {
  const last = new Map<string, Snapshot | null>();
  const broken: string[] = [];
  const ordered = [...entries].sort(chronological);
  for (const entry of ordered) {
    const previous = last.get(entry.targetId) ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(entry.before)) broken.push(entry.id);
    last.set(entry.targetId, entry.after);
  }
  return broken;
}
