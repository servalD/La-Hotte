import type { AuditWrite } from '../../../shared/domain';
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

interface ReportRow extends NewReport {
  status: 'OPEN' | 'DECIDED';
}

const same = (a: ModerationTarget, b: ModerationTarget) => a.kind === b.kind && a.id === b.id;

/**
 * Double des tests. `authorOf` dit qui a écrit une cible (branché par le banc sur les doubles de
 * `catalog` et `conversations`) ; `audit` reçoit les entrées de la « transaction ».
 */
export class InMemoryModerationStore extends ModerationStore {
  readonly reports: ReportRow[] = [];
  readonly decisions: DecisionRecord[] = [];
  authorOf: (target: ModerationTarget) => string | null = () => null;
  isLiveRemovedComment: (commentId: string) => boolean = () => true;
  /** Cible encore lisible (message non supprimé, fiche existante), branché par le banc. */
  isLiveTarget: (target: ModerationTarget) => boolean = () => true;

  constructor(private readonly audit: (write: AuditWrite) => void = () => undefined) {
    super();
  }

  addReport(report: NewReport): Promise<{ created: boolean; distinctAccounts: number }> {
    const exists = this.reports.some(
      (r) => r.reporterProfileId === report.reporterProfileId && same(r.target, report.target),
    );
    if (!exists) this.reports.push({ ...report, status: 'OPEN' });
    const accounts = new Set(
      this.reports
        .filter((r) => r.status === 'OPEN' && same(r.target, report.target))
        .map((r) => r.reporterAccountId),
    );
    return Promise.resolve({ created: !exists, distinctAccounts: accounts.size });
  }

  private summarize(target: ModerationTarget): OpenReports | null {
    const rows = this.reports.filter((r) => r.status === 'OPEN' && same(r.target, target));
    if (rows.length === 0) return null;
    const counts = new Map<ReportReason, number>();
    for (const row of rows) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
    return {
      target,
      reasons: [...counts].map(([reason, count]) => ({ reason, count })),
      notes: rows.flatMap((r) => (r.note ? [r.note] : [])).slice(0, 10),
      firstAt: rows.reduce((min, r) => (r.at < min ? r.at : min), rows[0]?.at ?? new Date()),
    };
  }

  openReports(limit: number): Promise<OpenReports[]> {
    const targets: ModerationTarget[] = [];
    for (const r of this.reports) {
      if (
        r.status === 'OPEN' &&
        this.isLiveTarget(r.target) &&
        !targets.some((t) => same(t, r.target))
      ) {
        targets.push(r.target);
      }
    }
    return Promise.resolve(
      targets.slice(0, limit).flatMap((t) => {
        const summary = this.summarize(t);
        return summary ? [summary] : [];
      }),
    );
  }

  openReportsOn(target: ModerationTarget): Promise<OpenReports | null> {
    return Promise.resolve(this.summarize(target));
  }

  record(input: {
    decision: DecisionRecord;
    audit: AuditWrite;
    closeReports: boolean;
    expectedLastDecisionId?: string | null;
  }): Promise<boolean> {
    const { decision } = input;
    if (
      input.expectedLastDecisionId !== undefined &&
      this.last(decision.target) !== input.expectedLastDecisionId
    ) {
      return Promise.resolve(false);
    }
    if (
      decision.parentId !== null &&
      this.decisions.some((d) => d.parentId === decision.parentId && d.action !== 'CONTEST')
    ) {
      return Promise.resolve(false);
    }
    this.audit(input.audit);
    this.decisions.push(input.decision);
    if (input.closeReports) {
      for (const r of this.reports) {
        if (same(r.target, input.decision.target)) r.status = 'DECIDED';
      }
    }
    return Promise.resolve(true);
  }

  lastDecisionOn(target: ModerationTarget): Promise<string | null> {
    return Promise.resolve(this.last(target));
  }

  private last(target: ModerationTarget): string | null {
    const top = this.decisions.filter((d) => d.parentId === null && same(d.target, target));
    return top.at(-1)?.id ?? null;
  }

  findDecision(id: string): Promise<DecisionRecord | null> {
    return Promise.resolve(this.decisions.find((d) => d.id === id) ?? null);
  }

  contest(contest: DecisionRecord): Promise<'created' | 'already'> {
    if (this.decisions.some((d) => d.action === 'CONTEST' && d.parentId === contest.parentId)) {
      return Promise.resolve('already');
    }
    this.decisions.push(contest);
    return Promise.resolve('created');
  }

  openContests(limit: number): Promise<OpenContest[]> {
    return Promise.resolve(
      this.decisions
        .filter(
          (d) =>
            d.action === 'CONTEST' &&
            this.isLiveTarget(d.target) &&
            !this.decisions.some((c) => c.parentId === d.id),
        )
        .slice(0, limit)
        .flatMap((contest) => {
          const decision = this.decisions.find((d) => d.id === contest.parentId);
          return decision ? [{ contest, decision }] : [];
        }),
    );
  }

  contestOpen(contestId: string): Promise<boolean> {
    return Promise.resolve(
      this.decisions.some((d) => d.id === contestId && d.action === 'CONTEST') &&
        !this.decisions.some((c) => c.parentId === contestId),
    );
  }

  decisionsOnContentOf(profileId: string): Promise<DecisionOnMyContent[]> {
    return Promise.resolve(
      this.decisions
        .filter(
          (d) =>
            d.parentId === null &&
            (d.action === 'REMOVE' || d.action === 'REMOVE_AND_SUSPEND') &&
            this.authorOf(d.target) === profileId,
        )
        .map((d) => {
          const contest = this.decisions.find((c) => c.parentId === d.id && c.action === 'CONTEST');
          const outcome = contest
            ? this.decisions.find((r) => r.parentId === contest.id)
            : undefined;
          return {
            id: d.id,
            target: d.target,
            action: d.action as ModerationDecisionKind,
            reason: d.reason,
            at: d.at,
            contested: contest !== undefined,
            contestOutcome: outcome ? (outcome.action === 'KEEP' ? 'OVERTURN' : 'UPHOLD') : null,
          };
        }),
    );
  }

  commentsToErase(before: Date): Promise<string[]> {
    return Promise.resolve(
      this.decisions
        .filter(
          (d) =>
            d.target.kind === 'COMMENT' &&
            d.parentId === null &&
            (d.action === 'REMOVE' || d.action === 'REMOVE_AND_SUSPEND') &&
            d.at < before &&
            this.isLiveRemovedComment(d.target.id) &&
            !this.decisions.some(
              (k) =>
                k.parentId === d.id &&
                k.action === 'CONTEST' &&
                !this.decisions.some((r) => r.parentId === k.id),
            ),
        )
        .map((d) => d.target.id),
    );
  }
}
