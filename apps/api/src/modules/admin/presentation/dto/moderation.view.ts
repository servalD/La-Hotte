import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
  CONTEST_OUTCOMES,
  type ContestOutcome,
  MODERATION_DECISIONS,
  type ModerationDecisionKind,
  REPORT_REASONS,
  REPORT_TARGET_KINDS,
  type ReportReason,
  type ReportTargetKind,
} from '../../application/moderation.contract';

export class ReportReasonCountView {
  @ApiProperty({ enum: REPORT_REASONS, enumName: 'ReportReason' }) reason!: ReportReason;
  @ApiProperty() count!: number;
}

/** ADM-05 : motifs et notes des signaleurs, jamais leur identité. */
export class OpenReportsView {
  @ApiProperty({ type: [ReportReasonCountView] }) reasons!: ReportReasonCountView[];
  @ApiProperty({ type: [String] }) notes!: string[];
  @ApiProperty({ type: String, format: 'date-time' }) firstAt!: string;
}

/** MOD-10 : la fiche elle-même, sans auteur ni photo de l'utilisateur. */
export class ProductUnderReviewView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: String, nullable: true }) imageKey!: string | null;
  @ApiProperty({ type: String, nullable: true }) merchant!: string | null;
  @ApiProperty({ type: String, nullable: true }) sourceUrl!: string | null;
  @ApiProperty({ enum: ['NONE', 'PENDING', 'APPROVED', 'REJECTED'], enumName: 'ModerationStatus' })
  status!: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
}

/**
 * ADM-05, MOD-10 : un message signalé, avec son texte et son fil, rien d'autre : ni élément, ni
 * liste, ni destinataires, ni auteur, ni autres messages.
 */
export class CommentUnderReviewView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['PUBLIC', 'GIVERS'], enumName: 'CommentThread' })
  thread!: 'PUBLIC' | 'GIVERS';
  @ApiProperty() body!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class ProductQueueEntryView {
  @ApiProperty({ enum: ['PRODUCT'] }) kind!: 'PRODUCT';
  @ApiProperty({ type: ProductUnderReviewView }) product!: ProductUnderReviewView;
  @ApiProperty({ type: OpenReportsView, nullable: true }) reports!: OpenReportsView | null;
}

export class CommentQueueEntryView {
  @ApiProperty({ enum: ['COMMENT'] }) kind!: 'COMMENT';
  @ApiProperty({ type: CommentUnderReviewView }) comment!: CommentUnderReviewView;
  @ApiProperty({ type: OpenReportsView, nullable: true }) reports!: OpenReportsView | null;
}

export class ContestedDecisionView {
  @ApiProperty({ enum: [...MODERATION_DECISIONS, 'CONTEST'] }) action!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ type: String, format: 'date-time' }) at!: string;
  @ApiProperty({ enum: REPORT_TARGET_KINDS, enumName: 'ReportTargetKind' })
  targetKind!: ReportTargetKind;
}

export class ContestQueueEntryView {
  @ApiProperty({ enum: ['CONTEST'] }) kind!: 'CONTEST';
  @ApiProperty({ format: 'uuid' }) contestId!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ type: ContestedDecisionView }) decision!: ContestedDecisionView;
  @ApiProperty({ type: ProductUnderReviewView, nullable: true })
  product!: ProductUnderReviewView | null;
  @ApiProperty({ type: CommentUnderReviewView, nullable: true })
  comment!: CommentUnderReviewView | null;
}

export type QueueEntryView = ProductQueueEntryView | CommentQueueEntryView | ContestQueueEntryView;

@ApiExtraModels(ProductQueueEntryView, CommentQueueEntryView, ContestQueueEntryView)
export class ModerationQueueView {
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(ProductQueueEntryView) },
        { $ref: getSchemaPath(CommentQueueEntryView) },
        { $ref: getSchemaPath(ContestQueueEntryView) },
      ],
      discriminator: { propertyName: 'kind' },
    },
  })
  items!: QueueEntryView[];
}

/** MOD-11 : décision sur un contenu de l'auteur, sans modérateur ni signaleur. */
export class DecisionOnMyContentView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: REPORT_TARGET_KINDS, enumName: 'ReportTargetKind' })
  targetKind!: ReportTargetKind;
  @ApiProperty({ format: 'uuid' }) targetId!: string;
  @ApiProperty({ enum: MODERATION_DECISIONS, enumName: 'ModerationDecision' })
  action!: ModerationDecisionKind;
  @ApiProperty() reason!: string;
  @ApiProperty({ type: String, format: 'date-time' }) at!: string;
  @ApiProperty() contested!: boolean;
  @ApiProperty({ enum: CONTEST_OUTCOMES, enumName: 'ContestOutcome', nullable: true })
  contestOutcome!: ContestOutcome | null;
  @ApiProperty() canContest!: boolean;
}

export class DecisionsOnMyContentView {
  @ApiProperty({ type: [DecisionOnMyContentView] }) items!: DecisionOnMyContentView[];
}
