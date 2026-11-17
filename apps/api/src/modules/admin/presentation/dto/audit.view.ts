import { ApiProperty } from '@nestjs/swagger';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_KINDS,
  type AuditAction,
  type AuditTargetKind,
} from '../../../../shared/domain';

/**
 * AUD-06 : une entrée du journal. Aucun contenu d'utilisateur : identifiants opaques, motif saisi
 * par l'administrateur, valeurs d'un réglage (ADM-09).
 */
export class AuditEntryView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) at!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) actorAccountId!: string | null;
  @ApiProperty({ enum: AUDIT_ACTIONS, enumName: 'AuditAction' }) action!: AuditAction;
  @ApiProperty({ enum: AUDIT_TARGET_KINDS, enumName: 'AuditTargetKind', nullable: true })
  targetKind!: AuditTargetKind | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) targetId!: string | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, nullable: true }) ip!: string | null;
  /** Valeur d'un réglage avant et après (ADM-09) ; `null` sinon. */
  @ApiProperty({
    nullable: true,
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'array', items: { type: 'string' } },
    ],
  })
  before!: string | number | boolean | string[] | null;
  @ApiProperty({
    nullable: true,
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'array', items: { type: 'string' } },
    ],
  })
  after!: string | number | boolean | string[] | null;
}

export class AuditPageView {
  @ApiProperty({ type: [AuditEntryView] }) items!: AuditEntryView[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
