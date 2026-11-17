import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { MAX_MINOR } from '../../application/contract';
import { AccountingPersonView } from './accounting.view';

/** CPT-12, CPT-55 : prix réellement payé, s'il diffère (obligatoire sans prix). */
export class MarkPurchasedDto {
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: MAX_MINOR })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINOR)
  actualTotalMinor?: number | null;
}

/** CPT-63 : passé 24 heures, décocher exige `confirm=true`. */
export class UncheckPurchaseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  confirm?: boolean;
}

/** CPT-18 */
export class LowerContributionDto {
  @ApiProperty({ minimum: 0, maximum: MAX_MINOR })
  @IsInt()
  @Min(0)
  @Max(MAX_MINOR)
  amountMinor!: number;
}

/** CPT-19 : personnes à prévenir, parmi les autres participants (aucune : personne). */
export class ShortfallNoticeDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 50 })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  profileIds!: string[];
}

export class CartEventView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
}

/** CPT-11 : un élément du panier, avec son état de financement. */
export class CartLineView {
  @ApiProperty({ format: 'uuid' }) accountingId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) itemId!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) sourceUrl!: string | null;
  @ApiProperty({ type: Number, nullable: true }) quantity!: number | null;
  @ApiProperty({ minLength: 3, maxLength: 3 }) currency!: string;
  @ApiProperty({ type: Number, nullable: true }) totalMinor!: number | null;
  @ApiProperty() coveredMinor!: number;
  @ApiProperty({ type: Number, nullable: true }) remainingMinor!: number | null;
  @ApiProperty({ type: Number, nullable: true }) myShareMinor!: number | null;
  @ApiProperty() purchased!: boolean;
}

export class CartGroupView {
  @ApiProperty({ type: CartEventView, nullable: true }) event!: CartEventView | null;
  @ApiProperty({ type: [AccountingPersonView] }) recipients!: AccountingPersonView[];
  @ApiProperty({ type: [CartLineView] }) items!: CartLineView[];
}

export class CartView {
  @ApiProperty({ type: [CartGroupView] }) groups!: CartGroupView[];
}
