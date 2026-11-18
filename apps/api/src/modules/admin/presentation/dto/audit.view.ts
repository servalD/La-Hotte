import { ApiProperty } from '@nestjs/swagger';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_KINDS,
  type AuditAction,
  type AuditTargetKind,
} from '../../../../shared/domain';

type AuditScalarView = string | number | boolean | string[] | null;
export type AuditValueView = AuditScalarView | { key: string; value: AuditScalarView };

const SCALAR_SCHEMAS = [
  { type: 'string' },
  { type: 'number' },
  { type: 'boolean' },
  { type: 'array', items: { type: 'string' } },
] as const;

const AUDIT_VALUE_SCHEMA = {
  nullable: true,
  oneOf: [
    ...SCALAR_SCHEMAS,
    {
      type: 'object',
      required: ['key', 'value'],
      properties: { key: { type: 'string' }, value: { nullable: true, oneOf: SCALAR_SCHEMAS } },
    },
  ],
} as never;

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
  /** Valeur avant et après : rôle, empreinte d'une recherche, ou réglage et sa clé (ADM-09). */
  @ApiProperty(AUDIT_VALUE_SCHEMA) before!: AuditValueView;
  @ApiProperty(AUDIT_VALUE_SCHEMA) after!: AuditValueView;
}

export class AuditPageView {
  @ApiProperty({ type: [AuditEntryView] }) items!: AuditEntryView[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
