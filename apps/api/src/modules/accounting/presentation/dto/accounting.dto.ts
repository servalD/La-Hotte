import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { MAX_MINOR } from '../../application/contract';

/** CPT-53 : 10 000 pour un pour cent au centième, 2 à 10 pour une part. */
const SHARE_DENOMINATORS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10_000];

export const CONTRIBUTION_INPUT_MODES = ['FULL', 'PERCENT', 'FIXED', 'UNITS'] as const;

/**
 * CPT-01, CPT-04, CPT-53 à CPT-56. Un pourcentage est une fraction exacte : `shareNum` sur
 * `shareDen`, où `shareDen` vaut 10 000 (pour cent au centième) ou 2 à 10 (une part).
 */
export class SetContributionDto {
  @ApiProperty({ enum: CONTRIBUTION_INPUT_MODES, enumName: 'ContributionInputMode' })
  @IsIn(CONTRIBUTION_INPUT_MODES)
  mode!: (typeof CONTRIBUTION_INPUT_MODES)[number];

  @ApiPropertyOptional({ minimum: 1, maximum: 10_000 })
  @ValidateIf((dto: SetContributionDto) => dto.mode === 'PERCENT')
  @IsInt()
  @Min(1)
  @Max(10_000)
  shareNum?: number;

  @ApiPropertyOptional({ enum: SHARE_DENOMINATORS, type: Number })
  @ValidateIf((dto: SetContributionDto) => dto.mode === 'PERCENT')
  @IsInt()
  @IsIn(SHARE_DENOMINATORS)
  shareDen?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_MINOR })
  @ValidateIf((dto: SetContributionDto) => dto.mode === 'FIXED')
  @IsInt()
  @Min(1)
  @Max(MAX_MINOR)
  amountMinor?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 999 })
  @ValidateIf((dto: SetContributionDto) => dto.mode === 'UNITS')
  @IsInt()
  @Min(1)
  @Max(999)
  units?: number;
}

/** CPT-58 */
export class AccountingOptionsDto {
  @ApiProperty() @IsBoolean() reviewEnabled!: boolean;
  @ApiProperty() @IsBoolean() receiptEnabled!: boolean;
}
