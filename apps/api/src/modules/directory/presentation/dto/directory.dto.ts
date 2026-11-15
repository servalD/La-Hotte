import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const SHARE_LEVELS = ['PRIVATE', 'CIRCLE', 'GLOBAL'] as const;
export const HIDDEN_ITEM_CHOICES = ['MAKE_VISIBLE_TO_ALL'] as const;

/** `PUT /products/{id}/share` (REP-02, REP-06). */
export class ShareProductDto {
  @IsIn(SHARE_LEVELS)
  @ApiProperty({ enum: SHARE_LEVELS, enumName: 'ShareLevel' })
  level!: (typeof SHARE_LEVELS)[number];

  /** REP-06 : « Le rendre visible de tous et le publier ». */
  @IsOptional()
  @IsIn(HIDDEN_ITEM_CHOICES)
  @ApiProperty({ required: false, enum: HIDDEN_ITEM_CHOICES, enumName: 'HiddenItemChoice' })
  hiddenItemChoice?: (typeof HIDDEN_ITEM_CHOICES)[number];
}

/** `GET /directory` (REP-03, VIS-40) ; `scope=global` attend la phase 7 (REP-09). */
export class DirectoryQueryDto {
  @IsOptional()
  @IsIn(['circle'])
  @ApiProperty({ required: false, enum: ['circle'], default: 'circle' })
  scope?: 'circle';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @ApiProperty({ required: false, maxLength: 100 })
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @ApiProperty({ required: false, minimum: 1, maximum: 50, default: 50 })
  limit?: number;
}
