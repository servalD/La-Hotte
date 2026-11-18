import { type AuditWrite, DomainError } from '../../../shared/domain';

export const REPORT_TARGET_KINDS = ['PRODUCT', 'COMMENT'] as const;
export type ReportTargetKind = (typeof REPORT_TARGET_KINDS)[number];

/** MOD-07 : motifs en liste fermée. */
export const REPORT_REASONS = ['SPAM', 'INAPPROPRIATE', 'PRIVACY', 'ILLEGAL', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** MOD-10 : décisions sur un contenu. */
export const MODERATION_DECISIONS = ['KEEP', 'REMOVE', 'REMOVE_AND_SUSPEND'] as const;
export type ModerationDecisionKind = (typeof MODERATION_DECISIONS)[number];

/** MOD-11 : issue d'une contestation. */
export const CONTEST_OUTCOMES = ['UPHOLD', 'OVERTURN'] as const;
export type ContestOutcome = (typeof CONTEST_OUTCOMES)[number];

/** MOD-08 : trois comptes distincts masquent la cible. */
export const REPORT_MASK_THRESHOLD = 3;
/** MOD-11 : une contestation dans les 14 jours. */
export const CONTEST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const REPORT_NOTE_MAX = 500;
export const MODERATION_QUEUE_MAX = 50;

export interface ModerationTarget {
  readonly kind: ReportTargetKind;
  readonly id: string;
}

export interface NewReport {
  readonly id: string;
  readonly reporterProfileId: string;
  readonly reporterAccountId: string;
  readonly target: ModerationTarget;
  readonly reason: ReportReason;
  readonly note: string | null;
  readonly at: Date;
}

/** Signalements ouverts d'une cible, résumés pour la file (ADM-05). */
export interface OpenReports {
  readonly target: ModerationTarget;
  readonly reasons: readonly { readonly reason: ReportReason; readonly count: number }[];
  readonly notes: readonly string[];
  readonly firstAt: Date;
}

export type DecisionAction = ModerationDecisionKind | 'CONTEST';

export interface DecisionRecord {
  readonly id: string;
  readonly target: ModerationTarget;
  readonly action: DecisionAction;
  readonly reason: string;
  readonly actorAccountId: string;
  readonly parentId: string | null;
  readonly at: Date;
}

/** Contestation sans décision (MOD-11), avec la décision contestée. */
export interface OpenContest {
  readonly contest: DecisionRecord;
  readonly decision: DecisionRecord;
}

/** Décision sur un contenu de l'auteur, telle qu'il la voit (MOD-11) : jamais l'acteur. */
export interface DecisionOnMyContent {
  readonly id: string;
  readonly target: ModerationTarget;
  readonly action: ModerationDecisionKind;
  readonly reason: string;
  readonly at: Date;
  readonly contested: boolean;
  /** Issue de la contestation, si elle est tranchée. */
  readonly contestOutcome: ContestOutcome | null;
}

/**
 * Signalements et décisions (MOD-07 à MOD-11). Une décision, son entrée d'audit et la clôture des
 * signalements s'écrivent dans une même transaction (AUD-05).
 */
export abstract class ModerationStore {
  /** MOD-07 : un profil signale une cible une fois ; rend le nombre de comptes distincts ouverts. */
  abstract addReport(
    report: NewReport,
  ): Promise<{ readonly created: boolean; readonly distinctAccounts: number }>;

  abstract openReports(limit: number): Promise<OpenReports[]>;
  abstract openReportsOn(target: ModerationTarget): Promise<OpenReports | null>;

  abstract record(input: {
    readonly decision: DecisionRecord;
    readonly audit: AuditWrite;
    /** Clôt les signalements ouverts de la cible. */
    readonly closeReports: boolean;
    /**
     * Décision de premier niveau : dernière décision connue sur la cible au moment de juger. Une
     * autre décision écrite entre-temps fait refuser celle-ci (deux modérateurs à la fois).
     * Absent pour la réponse à une contestation, protégée par un index unique.
     */
    readonly expectedLastDecisionId?: string | null;
  }): Promise<boolean>;
  /** Dernière décision de premier niveau sur une cible, ou `null`. */
  abstract lastDecisionOn(target: ModerationTarget): Promise<string | null>;

  abstract findDecision(id: string): Promise<DecisionRecord | null>;
  /** MOD-11 : `already` si la décision a déjà sa contestation (index unique). */
  abstract contest(contest: DecisionRecord): Promise<'created' | 'already'>;
  abstract openContests(limit: number): Promise<OpenContest[]>;
  /** Décisions sur les contenus dont ce profil est l'auteur (MOD-11). */
  abstract decisionsOnContentOf(profileId: string): Promise<DecisionOnMyContent[]>;
  /**
   * MOD-11 : messages retirés dont le texte doit être effacé (délai de contestation passé sans
   * contestation ouverte, ou retrait maintenu).
   */
  abstract commentsToErase(before: Date): Promise<string[]>;
}

/** MOD-07 : on ne signale pas son propre contenu. */
export class ReportOwnContentError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'REPORT_OWN_CONTENT';
  constructor() {
    super('Vous ne pouvez pas signaler votre propre contenu.');
  }
}

/** MOD-07, SEC-04 : cible illisible ou inconnue, même réponse. */
export class ReportTargetNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'REPORT_TARGET_NOT_FOUND';
  constructor() {
    super('Contenu introuvable.');
  }
}

/** MOD-10 : rien à décider sur cette cible (ni signalement ouvert, ni attente). */
export class NothingToModerateError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'NOTHING_TO_MODERATE';
  constructor() {
    super('Ce contenu n’attend aucune décision.');
  }
}

/** MOD-11 : contestation hors délai, d'une décision « garder », ou déjà faite. */
export class ContestNotAllowedError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'CONTEST_NOT_ALLOWED';
  constructor() {
    super('Cette décision ne peut plus être contestée.');
  }
}

/** MOD-11 : la contestation est tranchée par un autre modérateur que celui qui a décidé. */
export class ContestSameModeratorError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'CONTEST_SAME_MODERATOR';
  constructor() {
    super('Un autre modérateur doit trancher cette contestation.');
  }
}

/** Décision ou contestation inconnue, ou d'un autre auteur (SEC-04). */
export class DecisionNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'DECISION_NOT_FOUND';
  constructor() {
    super('Décision introuvable.');
  }
}
