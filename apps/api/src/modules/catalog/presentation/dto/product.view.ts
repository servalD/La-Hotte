import { ApiProperty } from '@nestjs/swagger';

const SOURCES = ['LINK', 'PHOTO', 'MANUAL'] as const;
const SHARE_LEVELS = ['PRIVATE', 'CIRCLE', 'GLOBAL'] as const;
const EXTRACTION = ['NONE', 'PENDING', 'DONE', 'FAILED'] as const;

/** Fiche vue par son propriétaire (ART-05), brouillon compris (EXT-07). */
export class ProductView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  /** EXT-47 : à lire par `GET /images/{key}`. */
  @ApiProperty({ type: String, nullable: true })
  imageKey!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  unitPriceMinor!: number | null;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ type: String, nullable: true })
  merchant!: string | null;

  @ApiProperty({ type: String, nullable: true })
  sourceUrl!: string | null;

  @ApiProperty({ enum: SOURCES, enumName: 'ProductSource' })
  source!: (typeof SOURCES)[number];

  @ApiProperty({ enum: SHARE_LEVELS, enumName: 'ShareLevel' })
  shareLevel!: (typeof SHARE_LEVELS)[number];

  @ApiProperty({ enum: EXTRACTION, enumName: 'ExtractionStatus' })
  extractionStatus!: (typeof EXTRACTION)[number];

  /** EXT-07 : champs incertains du brouillon. */
  @ApiProperty({ type: [String] })
  uncertainFields!: string[];

  /** EXT-34 : « page partiellement analysée ». */
  @ApiProperty()
  extractionTruncated!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  priceCheckedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  /** À renvoyer dans `If-Match` (API-17). */
  @ApiProperty()
  version!: number;
}

export class ProductPageView {
  @ApiProperty({ type: [ProductView] })
  items!: ProductView[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
