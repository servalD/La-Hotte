import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  PRICE_MINOR_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_MERCHANT_MAX,
  PRODUCT_TITLE_MAX,
  PRODUCT_URL_MAX,
} from '../../application/contract';

// API-04 : contraintes explicites ; champs inconnus refusés. Aucun contenu dans un message d'erreur.

const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true };

/** `POST /products` : saisie à la main (EXT-20) ; seul le titre est obligatoire. */
export class CreateProductDto {
  @IsString()
  @Length(1, PRODUCT_TITLE_MAX)
  @Matches(/\S/)
  @ApiProperty({ minLength: 1, maxLength: PRODUCT_TITLE_MAX })
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_DESCRIPTION_MAX)
  @ApiProperty({ required: false, maxLength: PRODUCT_DESCRIPTION_MAX })
  description?: string;

  /** ART-11 : unités mineures ; absent ou `null` = prix libre (EXT-20). */
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(PRICE_MINOR_MAX)
  @ApiProperty({
    type: Number,
    required: false,
    nullable: true,
    minimum: 0,
    maximum: PRICE_MINOR_MAX,
  })
  unitPriceMinor?: number | null;

  /** ISO 4217 ; par défaut EUR. */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  @ApiProperty({ required: false, pattern: '^[A-Z]{3}$', example: 'EUR' })
  currency?: string;

  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(PRODUCT_MERCHANT_MAX)
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: PRODUCT_MERCHANT_MAX })
  merchant?: string | null;

  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUrl(URL_OPTIONS)
  @MaxLength(PRODUCT_URL_MAX)
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    format: 'uri',
    maxLength: PRODUCT_URL_MAX,
  })
  sourceUrl?: string | null;
}

/** `PATCH /products/{id}` (ART-03) ; `If-Match` exigé (API-17). */
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(1, PRODUCT_TITLE_MAX)
  @Matches(/\S/)
  @ApiProperty({ required: false, minLength: 1, maxLength: PRODUCT_TITLE_MAX })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_DESCRIPTION_MAX)
  @ApiProperty({ required: false, maxLength: PRODUCT_DESCRIPTION_MAX })
  description?: string;

  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(PRICE_MINOR_MAX)
  @ApiProperty({
    type: Number,
    required: false,
    nullable: true,
    minimum: 0,
    maximum: PRICE_MINOR_MAX,
  })
  unitPriceMinor?: number | null;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  @ApiProperty({ required: false, pattern: '^[A-Z]{3}$' })
  currency?: string;

  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(PRODUCT_MERCHANT_MAX)
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: PRODUCT_MERCHANT_MAX })
  merchant?: string | null;

  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUrl(URL_OPTIONS)
  @MaxLength(PRODUCT_URL_MAX)
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    format: 'uri',
    maxLength: PRODUCT_URL_MAX,
  })
  sourceUrl?: string | null;
}

/** API-15 */
export class ProductPageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiProperty({ required: false, maxLength: 200 })
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @ApiProperty({ required: false, minimum: 1, maximum: 50, default: 50 })
  limit?: number;
}
