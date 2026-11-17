import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import {
  CONTEST_OUTCOMES,
  type ContestOutcome,
  MODERATION_DECISIONS,
  type ModerationDecisionKind,
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  REPORT_TARGET_KINDS,
  type ReportReason,
  type ReportTargetKind,
} from '../../application/moderation.contract';
import { AdminReasonDto } from './accounts.dto';

/** `POST /reports` (MOD-07). */
export class ReportDto {
  @IsIn(REPORT_TARGET_KINDS)
  @ApiProperty({ enum: REPORT_TARGET_KINDS, enumName: 'ReportTargetKind' })
  targetKind!: ReportTargetKind;

  @IsUUID()
  @ApiProperty({ format: 'uuid' })
  targetId!: string;

  @IsIn(REPORT_REASONS)
  @ApiProperty({ enum: REPORT_REASONS, enumName: 'ReportReason' })
  reason!: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(REPORT_NOTE_MAX)
  @ApiProperty({ required: false, maxLength: REPORT_NOTE_MAX })
  note?: string;
}

/** `POST /moderation-decisions/{id}/contest` (MOD-11). */
export class ContestDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  @ApiProperty({ minLength: 10, maxLength: 500 })
  text!: string;
}

export const MODERATED_KINDS = ['products', 'comments'] as const;

export class ModerationTargetParams {
  @IsIn(MODERATED_KINDS)
  @ApiProperty({ enum: MODERATED_KINDS })
  kind!: (typeof MODERATED_KINDS)[number];

  @IsUUID()
  @ApiProperty({ format: 'uuid' })
  id!: string;
}

/** MOD-10 : décision motivée. */
export class ModerationDecisionDto extends AdminReasonDto {
  @IsIn(MODERATION_DECISIONS)
  @ApiProperty({ enum: MODERATION_DECISIONS, enumName: 'ModerationDecision' })
  decision!: ModerationDecisionKind;
}

/** MOD-11 : issue d'une contestation. */
export class ContestDecisionDto extends AdminReasonDto {
  @IsIn(CONTEST_OUTCOMES)
  @ApiProperty({ enum: CONTEST_OUTCOMES, enumName: 'ContestOutcome' })
  outcome!: ContestOutcome;
}
