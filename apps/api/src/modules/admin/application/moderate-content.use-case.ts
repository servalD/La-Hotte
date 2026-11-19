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
import { AccountProfileIds, SuspendPublication } from '../../identity';
import { ProductReferences } from '../../lists';
import { moderationWithheld } from '../../visibility';
import {
  CONTEST_WINDOW_MS,
  ContestNotAllowedError,
  type ContestOutcome,
  ContestSameModeratorError,
  DecisionNotFoundError,
  type DecisionOnMyContent,
  type DecisionRecord,
  MODERATION_QUEUE_MAX,
  type ModerationConcern,
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

/** Modérateur ou administrateur qui lit ou décide : son compte et ses profils (ADM-05). */
export interface ModerationActor {
  readonly accountId: string;
  readonly profileIds: readonly string[];
}

function concernWithholds(actor: ModerationActor, concern: ModerationConcern): boolean {
  return (
    concern.referenceUnknown ||
    moderationWithheld({
      actorProfileIds: actor.profileIds,
      authorId: concern.authorId,
      references: concern.references,
    })
  );
}

/** Accès aux cibles : lecture pour la file, auteur pour l'avis, gestes de modération. */
@Injectable()
export class ModerationTargets {
  constructor(
    private readonly catalog: ProductCatalog,
    private readonly comments: CommentModerationGate,
    private readonly references: ProductReferences,
    private readonly accountProfiles: AccountProfileIds,
    private readonly store: ModerationStore,
  ) {}

  /** Compte et profils du modérateur, lus une fois par requête (ADM-05). */
  async actor(actorAccountId: string): Promise<ModerationActor> {
    return {
      accountId: actorAccountId,
      profileIds: await this.accountProfiles.execute(actorAccountId),
    };
  }

  /**
   * Qui la cible concerne aujourd'hui (auteur, éléments qui la référencent, retirés compris : M4) ;
   * `null` si elle a disparu.
   */
  async concernOf(
    target: ModerationTarget,
    loaded?: Product | CommentForModeration | null,
  ): Promise<ModerationConcern | null> {
    if (target.kind === 'PRODUCT') {
      const product = (loaded as Product | null | undefined) ?? (await this.product(target.id));
      if (!product) return null;
      const references =
        (await this.references.of([product.id], { withdrawn: true })).get(product.id) ?? [];
      return { authorId: product.ownerProfileId || null, references, referenceUnknown: false };
    }
    const comment =
      (loaded as CommentForModeration | null | undefined) ?? (await this.comment(target.id));
    if (!comment) return null;
    return {
      authorId: comment.authorId,
      references: comment.reference ? [comment.reference] : [],
      // Sans élément connu, rien ne permet d'écarter un destinataire : le message est soustrait.
      referenceUnknown: comment.reference === null,
    };
  }

  /**
   * ADM-05, MOD-10 : la cible est soustraite au modérateur comme si elle n'existait pas quand elle
   * concerne un profil de son compte (auteur, destinataire, écarté, honoré), quand elle a disparu
   * (R1 : plus rien ne dit qui elle concerne), ou quand ce compte l'a signalée (revue SEC-40 des
   * restes de la phase 7, B1 : sinon son absence, après son propre signalement, le lui dirait).
   */
  async withheld(
    actor: ModerationActor,
    target: ModerationTarget,
    loaded?: Product | CommentForModeration | null,
  ): Promise<boolean> {
    return (await this.assess(actor, target, loaded)).standing !== 'visible';
  }

  /**
   * ADM-05, AUD-06 (revue SEC-40, M1, I2, puis n1 et n2 du cycle 2) : un seul jugement pour la
   * file, les décisions, les contestations et le journal. `withheld` : la cible le concerne
   * aujourd'hui, ou le concernait à une décision (faits figés), ou son compte l'a signalée ; `gone` :
   * elle a disparu sans l'avoir jamais concerné. Les trois lectures sont toujours faites, ensemble :
   * le temps de réponse ne dit pas laquelle a décidé.
   */
  async assess(
    actor: ModerationActor,
    target: ModerationTarget,
    loaded?: Product | CommentForModeration | null,
  ): Promise<{
    readonly standing: 'visible' | 'withheld' | 'gone';
    readonly concern: ModerationConcern | null;
  }> {
    const [concern, past, reported] = await Promise.all([
      this.concernOf(target, loaded),
      this.store.concernsOn(target),
      this.store.reportedByAccount(actor.accountId, target),
    ]);
    const withheld =
      reported ||
      past.some((c) => concernWithholds(actor, c)) ||
      (concern !== null && concernWithholds(actor, concern));
    return { standing: withheld ? 'withheld' : concern ? 'visible' : 'gone', concern };
  }

  async standing(
    actor: ModerationActor,
    target: ModerationTarget,
  ): Promise<'visible' | 'withheld' | 'gone'> {
    return (await this.assess(actor, target)).standing;
  }

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
    // MOD-07 (revue SEC-40, cycle 3, I2) : ni son propre contenu, ni celui d'un autre profil du
    // même compte ; un compte ne remplit pas la file à lui seul.
    if (
      readable.authorId !== null &&
      (await this.targets.actor(input.accountId)).profileIds.includes(readable.authorId)
    ) {
      throw new ReportOwnContentError();
    }
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

  async execute(actorAccountId: string): Promise<QueueEntry[]> {
    const actor = await this.targets.actor(actorAccountId);
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
        if (await this.targets.withheld(actor, open.target, product)) continue;
        entries.push({ kind: 'PRODUCT', product: reviewOf(product), reports: open });
      } else {
        const comment = await this.targets.comment(open.target.id);
        if (!comment || comment.removed) continue;
        if (await this.targets.withheld(actor, open.target, comment)) continue;
        entries.push({ kind: 'COMMENT', comment: commentView(comment), reports: open });
      }
    }
    for (const product of pending) {
      if (seen.has(product.id)) continue;
      if (!(await this.targets.withheld(actor, { kind: 'PRODUCT', id: product.id }, product))) {
        entries.push({ kind: 'PRODUCT', product: reviewOf(product), reports: null });
      }
    }
    for (const { contest, decision } of contests) {
      if (await this.targets.withheld(actor, decision.target)) continue;
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

  record(input: Parameters<ModerationStore['record']>[0]): Promise<boolean> {
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
    const actor = await this.targets.actor(input.actorAccountId);
    const last = await this.store.lastDecisionOn(target);
    const open = await this.store.openReportsOn(target);
    let pending = false;
    let loaded: Product | CommentForModeration | null;
    if (target.kind === 'PRODUCT') {
      const product = await this.targets.product(target.id);
      if (!product) throw new ReportTargetNotFoundError();
      pending = product.shareLevel === 'GLOBAL' && product.moderationStatus === 'PENDING';
      loaded = product;
    } else {
      const comment = await this.targets.comment(target.id);
      if (!comment || comment.removed) throw new ReportTargetNotFoundError();
      loaded = comment;
    }
    // Une cible soustraite répond « rien à modérer », comme une cible sans signalement ni attente :
    // ni un `404` (il dirait à l'auteur d'une fiche qu'elle est signalée, m1), ni un ordre des
    // contrôles qui ferait différer le temps de réponse (m2). La soustraction est toujours examinée.
    const { standing, concern } = await this.targets.assess(actor, target, loaded);
    if ((!open && !pending) || standing !== 'visible' || !concern) {
      throw new NothingToModerateError();
    }
    const author = await this.targets.authorOf(target);
    const now = this.recorder.now();
    const recorded = await this.recorder.record({
      expectedLastDecisionId: last,
      decision: {
        id: this.recorder.newId(),
        target,
        action: input.decision,
        reason: input.reason,
        actorAccountId: input.actorAccountId,
        parentId: null,
        at: now,
      },
      concern,
      audit: this.recorder.audit(input, target, input.decision),
      closeReports: true,
    });
    if (!recorded) throw new NothingToModerateError();
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
    const actor = await this.targets.actor(input.actorAccountId);
    // ADM-05 : soustraite aujourd'hui, à une décision passée (I2), ou signalée par ce compte (B1).
    const { standing, concern } = await this.targets.assess(actor, decision.target);
    if (standing !== 'visible' || !concern) throw new DecisionNotFoundError();
    if (decision.actorAccountId === input.actorAccountId) throw new ContestSameModeratorError();
    if (!(await this.store.contestOpen(contest.id))) throw new NothingToModerateError();
    const now = this.recorder.now();
    const target = decision.target;
    const recorded = await this.recorder.record({
      decision: {
        id: this.recorder.newId(),
        target,
        action: input.outcome === 'OVERTURN' ? 'KEEP' : decision.action,
        reason: input.reason,
        actorAccountId: input.actorAccountId,
        parentId: contest.id,
        at: now,
      },
      concern,
      audit: this.recorder.audit(input, target, `CONTEST_${input.outcome}`),
      closeReports: false,
    });
    if (!recorded) throw new NothingToModerateError();
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
