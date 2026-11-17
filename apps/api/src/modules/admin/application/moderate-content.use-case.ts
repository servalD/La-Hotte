import { Injectable } from '@nestjs/common';
import {
  type AuditAction,
  AppEvents,
  AuditJournal,
  type AuditWrite,
  Clock,
  IdGenerator,
} from '../../../shared/domain';
import { type Product, ProductCatalog } from '../../catalog';
import { type CommentForModeration, CommentModerationGate } from '../../conversations';
import { DirectoryEntryReader } from '../../directory';
import { SuspendPublication } from '../../identity';
import {
  CONTEST_WINDOW_MS,
  ContestNotAllowedError,
  type ContestOutcome,
  ContestSameModeratorError,
  DecisionNotFoundError,
  type DecisionOnMyContent,
  type DecisionRecord,
  MODERATION_QUEUE_MAX,
  type ModerationDecisionKind,
  ModerationStore,
  type ModerationTarget,
  NothingToModerateError,
  type OpenReports,
  REPORT_MASK_THRESHOLD,
  type ReportReason,
  ReportOwnContentError,
  ReportTargetNotFoundError,
} from '../domain/moderation';

/** Ce qu'un modérateur voit d'une fiche (ADM-05, MOD-10) : la fiche, jamais son auteur. */
export interface ProductUnderReview {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** REP-04 : une photo de l'utilisateur n'est jamais montrée. */
  readonly imageKey: string | null;
  readonly merchant: string | null;
  readonly sourceUrl: string | null;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NONE';
}

export type QueueEntry =
  | {
      readonly kind: 'PRODUCT';
      readonly product: ProductUnderReview;
      readonly reports: OpenReports | null;
    }
  | {
      readonly kind: 'COMMENT';
      readonly comment: Pick<CommentForModeration, 'id' | 'thread' | 'body' | 'createdAt'>;
      readonly reports: OpenReports | null;
    }
  | {
      readonly kind: 'CONTEST';
      readonly contestId: string;
      readonly text: string;
      readonly decision: Pick<DecisionRecord, 'action' | 'reason' | 'at' | 'target'>;
      readonly product: ProductUnderReview | null;
      readonly comment: Pick<CommentForModeration, 'id' | 'thread' | 'body' | 'createdAt'> | null;
    };

function reviewOf(product: Product): ProductUnderReview {
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    imageKey: product.imageFromPhoto ? null : product.imageKey,
    merchant: product.merchant,
    sourceUrl: product.sourceUrl,
    status: product.moderationStatus,
  };
}

const commentView = (c: CommentForModeration) => ({
  id: c.id,
  thread: c.thread,
  body: c.body,
  createdAt: c.createdAt,
});

/** Accès aux cibles : lecture pour la file, auteur pour l'avis, gestes de modération. */
@Injectable()
export class ModerationTargets {
  constructor(
    private readonly catalog: ProductCatalog,
    private readonly comments: CommentModerationGate,
  ) {}

  product(id: string): Promise<Product | null> {
    return this.catalog.findById(id);
  }

  comment(id: string): Promise<CommentForModeration | null> {
    return this.comments.forModerator(id);
  }

  /** Auteur du contenu (profil), pour l'avis et la contestation ; jamais rendu au modérateur. */
  async authorOf(target: ModerationTarget): Promise<string | null> {
    if (target.kind === 'PRODUCT') {
      return (await this.catalog.findById(target.id))?.ownerProfileId || null;
    }
    return (await this.comments.forModerator(target.id))?.authorId ?? null;
  }

  async mask(target: ModerationTarget, at: Date): Promise<void> {
    if (target.kind === 'PRODUCT') await this.catalog.moderate(target.id, 'mask');
    else await this.comments.mask(target.id, at);
  }

  async keep(target: ModerationTarget): Promise<void> {
    if (target.kind === 'PRODUCT') await this.catalog.moderate(target.id, 'keep');
    else await this.comments.mask(target.id, null);
  }

  async remove(target: ModerationTarget, at: Date): Promise<void> {
    if (target.kind === 'PRODUCT') await this.catalog.moderate(target.id, 'remove');
    else await this.comments.remove(target.id, at);
  }

  async overturn(target: ModerationTarget): Promise<void> {
    if (target.kind === 'PRODUCT') await this.catalog.moderate(target.id, 'overturn');
    else await this.comments.remove(target.id, null);
  }

  async erase(commentIds: readonly string[], at: Date): Promise<number> {
    return this.comments.erase(commentIds, at);
  }
}

/** MOD-07, MOD-08 : signaler une fiche ou un message lisible ; masquage au troisième compte. */
@Injectable()
export class ReportContent {
  constructor(
    private readonly store: ModerationStore,
    private readonly directory: DirectoryEntryReader,
    private readonly comments: CommentModerationGate,
    private readonly targets: ModerationTargets,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly profileId: string;
    readonly accountId: string;
    readonly target: ModerationTarget;
    readonly reason: ReportReason;
    readonly note: string | null;
  }): Promise<void> {
    const readable =
      input.target.kind === 'PRODUCT'
        ? await this.directory
            .readable(input.profileId, input.target.id)
            .then((r) => (r ? { authorId: r.ownerProfileId } : null))
        : await this.comments.readable(input.profileId, input.target.id);
    if (!readable) throw new ReportTargetNotFoundError();
    if (readable.authorId === input.profileId) throw new ReportOwnContentError();
    const now = this.clock.now();
    const note = input.note?.trim() ? input.note.trim() : null;
    const { created, distinctAccounts } = await this.store.addReport({
      id: this.ids.next(),
      reporterProfileId: input.profileId,
      reporterAccountId: input.accountId,
      target: input.target,
      reason: input.reason,
      note,
      at: now,
    });
    if (created && distinctAccounts >= REPORT_MASK_THRESHOLD) {
      await this.targets.mask(input.target, now);
    }
  }
}

/** MOD-10 : file du modérateur (fiches en attente, contenus signalés, contestations). */
@Injectable()
export class ReadModerationQueue {
  constructor(
    private readonly store: ModerationStore,
    private readonly catalog: ProductCatalog,
    private readonly targets: ModerationTargets,
  ) {}

  async execute(): Promise<QueueEntry[]> {
    const [reports, pending, contests] = await Promise.all([
      this.store.openReports(MODERATION_QUEUE_MAX),
      this.catalog.pendingGlobal(MODERATION_QUEUE_MAX),
      this.store.openContests(MODERATION_QUEUE_MAX),
    ]);
    const entries: QueueEntry[] = [];
    const seen = new Set<string>();
    for (const open of reports) {
      if (open.target.kind === 'PRODUCT') {
        const product = await this.targets.product(open.target.id);
        if (!product) continue;
        seen.add(product.id);
        entries.push({ kind: 'PRODUCT', product: reviewOf(product), reports: open });
      } else {
        const comment = await this.targets.comment(open.target.id);
        if (!comment || comment.removed) continue;
        entries.push({ kind: 'COMMENT', comment: commentView(comment), reports: open });
      }
    }
    for (const product of pending) {
      if (!seen.has(product.id)) {
        entries.push({ kind: 'PRODUCT', product: reviewOf(product), reports: null });
      }
    }
    for (const { contest, decision } of contests) {
      const product =
        decision.target.kind === 'PRODUCT' ? await this.targets.product(decision.target.id) : null;
      const comment =
        decision.target.kind === 'COMMENT' ? await this.targets.comment(decision.target.id) : null;
      entries.push({
        kind: 'CONTEST',
        contestId: contest.id,
        text: contest.reason,
        decision: {
          action: decision.action,
          reason: decision.reason,
          at: decision.at,
          target: decision.target,
        },
        product: product ? reviewOf(product) : null,
        comment: comment ? commentView(comment) : null,
      });
    }
    return entries.slice(0, MODERATION_QUEUE_MAX * 2);
  }
}

/** Écriture d'une décision, puis ses effets ; un effet manqué laisse une entrée (AUD-05). */
@Injectable()
export class DecisionRecorder {
  constructor(
    private readonly store: ModerationStore,
    private readonly journal: AuditJournal,
    private readonly events: AppEvents,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  audit(
    input: { readonly actorAccountId: string; readonly ip: string; readonly reason: string },
    target: ModerationTarget,
    after: string,
  ): AuditWrite {
    return {
      id: this.ids.next(),
      at: this.clock.now(),
      entry: {
        actorAccountId: input.actorAccountId,
        action: 'moderation.decide',
        targetKind: target.kind,
        targetId: target.id,
        reason: input.reason,
        ip: input.ip,
        after,
      },
    };
  }

  newId(): string {
    return this.ids.next();
  }

  now(): Date {
    return this.clock.now();
  }

  record(input: Parameters<ModerationStore['record']>[0]): Promise<void> {
    return this.store.record(input);
  }

  async effects(
    actor: { readonly actorAccountId: string; readonly ip: string },
    target: ModerationTarget,
    action: AuditAction,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run();
    } catch {
      await this.journal.append({
        id: this.ids.next(),
        at: this.clock.now(),
        entry: {
          actorAccountId: actor.actorAccountId,
          action: 'followup.failed',
          targetKind: target.kind,
          targetId: target.id,
          reason: null,
          ip: actor.ip,
          after: action,
        },
      });
    }
  }

  notify(
    profileId: string | null,
    target: ModerationTarget,
    outcome: 'removed' | 'restored',
  ): void {
    if (!profileId) return;
    this.events.publish({ type: 'moderation.notice', profileId, targetKind: target.kind, outcome });
  }
}

/** MOD-10 : garder, retirer, retirer et suspendre la publication de l'auteur. */
@Injectable()
export class DecideModeration {
  constructor(
    private readonly store: ModerationStore,
    private readonly catalog: ProductCatalog,
    private readonly targets: ModerationTargets,
    private readonly recorder: DecisionRecorder,
    private readonly suspendPublication: SuspendPublication,
  ) {}

  async execute(input: {
    readonly actorAccountId: string;
    readonly ip: string;
    readonly target: ModerationTarget;
    readonly decision: ModerationDecisionKind;
    readonly reason: string;
  }): Promise<void> {
    const { target } = input;
    const open = await this.store.openReportsOn(target);
    let pending = false;
    if (target.kind === 'PRODUCT') {
      const product = await this.targets.product(target.id);
      if (!product) throw new ReportTargetNotFoundError();
      pending = product.shareLevel === 'GLOBAL' && product.moderationStatus === 'PENDING';
    } else {
      const comment = await this.targets.comment(target.id);
      if (!comment || comment.removed) throw new ReportTargetNotFoundError();
    }
    if (!open && !pending) throw new NothingToModerateError();
    const author = await this.targets.authorOf(target);
    const now = this.recorder.now();
    await this.recorder.record({
      decision: {
        id: this.recorder.newId(),
        target,
        action: input.decision,
        reason: input.reason,
        actorAccountId: input.actorAccountId,
        parentId: null,
        at: now,
      },
      audit: this.recorder.audit(input, target, input.decision),
      closeReports: true,
    });
    await this.recorder.effects(input, target, 'moderation.decide', async () => {
      if (input.decision === 'KEEP') {
        await this.targets.keep(target);
        return;
      }
      await this.targets.remove(target, now);
      if (input.decision === 'REMOVE_AND_SUSPEND' && author) {
        await this.suspendPublication.execute(author);
      }
    });
    if (input.decision !== 'KEEP') this.recorder.notify(author, target, 'removed');
  }
}

/** MOD-11 : l'auteur conteste une fois, dans les 14 jours, une décision de retrait. */
@Injectable()
export class ContestDecision {
  constructor(
    private readonly store: ModerationStore,
    private readonly targets: ModerationTargets,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly profileId: string;
    readonly accountId: string;
    readonly decisionId: string;
    readonly text: string;
  }): Promise<void> {
    const decision = await this.store.findDecision(input.decisionId);
    if (!decision || decision.parentId !== null) throw new DecisionNotFoundError();
    if ((await this.targets.authorOf(decision.target)) !== input.profileId) {
      throw new DecisionNotFoundError();
    }
    const now = this.clock.now();
    if (
      decision.action === 'KEEP' ||
      decision.action === 'CONTEST' ||
      now.getTime() - decision.at.getTime() > CONTEST_WINDOW_MS
    ) {
      throw new ContestNotAllowedError();
    }
    const outcome = await this.store.contest({
      id: this.ids.next(),
      target: decision.target,
      action: 'CONTEST',
      reason: input.text.trim(),
      actorAccountId: input.accountId,
      parentId: decision.id,
      at: now,
    });
    if (outcome === 'already') throw new ContestNotAllowedError();
  }
}

/** MOD-11 : un autre modérateur tranche ; sa décision est définitive. */
@Injectable()
export class DecideContest {
  constructor(
    private readonly store: ModerationStore,
    private readonly targets: ModerationTargets,
    private readonly recorder: DecisionRecorder,
  ) {}

  async execute(input: {
    readonly actorAccountId: string;
    readonly ip: string;
    readonly contestId: string;
    readonly outcome: ContestOutcome;
    readonly reason: string;
  }): Promise<void> {
    const contest = await this.store.findDecision(input.contestId);
    if (contest?.action !== 'CONTEST' || !contest.parentId) throw new DecisionNotFoundError();
    const decision = await this.store.findDecision(contest.parentId);
    if (!decision) throw new DecisionNotFoundError();
    if (decision.actorAccountId === input.actorAccountId) throw new ContestSameModeratorError();
    const open = (await this.store.openContests(500)).some((c) => c.contest.id === contest.id);
    if (!open) throw new NothingToModerateError();
    const now = this.recorder.now();
    const target = decision.target;
    await this.recorder.record({
      decision: {
        id: this.recorder.newId(),
        target,
        action: input.outcome === 'OVERTURN' ? 'KEEP' : decision.action,
        reason: input.reason,
        actorAccountId: input.actorAccountId,
        parentId: contest.id,
        at: now,
      },
      audit: this.recorder.audit(input, target, `CONTEST_${input.outcome}`),
      closeReports: false,
    });
    const author = await this.targets.authorOf(target);
    await this.recorder.effects(input, target, 'moderation.decide', async () => {
      if (input.outcome === 'OVERTURN') {
        await this.targets.overturn(target);
      } else if (target.kind === 'COMMENT') {
        // MOD-11 : retrait maintenu, le texte est effacé tout de suite.
        await this.targets.erase([target.id], now);
      }
    });
    if (input.outcome === 'OVERTURN') this.recorder.notify(author, target, 'restored');
  }
}

/** MOD-11 : décisions sur les contenus du profil, pour les voir et les contester. */
@Injectable()
export class ListDecisionsOnMyContent {
  constructor(private readonly store: ModerationStore) {}

  execute(profileId: string): Promise<DecisionOnMyContent[]> {
    return this.store.decisionsOnContentOf(profileId);
  }
}

/** MOD-11 : effacement du texte des messages retirés, une fois le délai de contestation passé. */
@Injectable()
export class EraseRemovedComments {
  constructor(
    private readonly store: ModerationStore,
    private readonly targets: ModerationTargets,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    const ids = await this.store.commentsToErase(new Date(now.getTime() - CONTEST_WINDOW_MS));
    return this.targets.erase(ids, now);
  }
}
