import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DIGEST_FREQUENCIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
} from '../../application/contract';

export const NOTIFICATION_TYPE_VALUES = Object.keys(
  NOTIFICATION_TYPES,
) as (keyof typeof NOTIFICATION_TYPES)[];

/** NOT-18, API-15 : pagination par numéro de séquence. */
export class NotificationsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // Revue SEC-40, M6 : au-delà, PostgreSQL refuserait l'entier (500).
  @Max(Number.MAX_SAFE_INTEGER)
  beforeSeq?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/** NOT-18 : une liste d'identifiants, ou tout jusqu'à un numéro. */
export class MarkReadDto {
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 200 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids?: string[];

  @ApiPropertyOptional({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsOptional()
  @IsInt()
  @Min(0)
  // Revue SEC-40, M6 : au-delà, PostgreSQL refuserait l'entier (500).
  @Max(Number.MAX_SAFE_INTEGER)
  upToSeq?: number;
}

/** RT-12 */
export class SyncQueryDto {
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  // Revue SEC-40, M6 : au-delà, PostgreSQL refuserait l'entier (500).
  @Max(Number.MAX_SAFE_INTEGER)
  since!: number;
}

export class ChannelPreferenceDto {
  @ApiProperty({ enum: NOTIFICATION_CATEGORIES, enumName: 'NotificationCategory' })
  @IsIn(NOTIFICATION_CATEGORIES)
  category!: (typeof NOTIFICATION_CATEGORIES)[number];

  @ApiProperty({ enum: NOTIFICATION_CHANNELS, enumName: 'NotificationChannel' })
  @IsIn(NOTIFICATION_CHANNELS)
  channel!: (typeof NOTIFICATION_CHANNELS)[number];

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

/** NOT-04, NOT-14, NOT-17, RT-11 */
export class UpdatePreferencesDto {
  @ApiProperty({ type: [ChannelPreferenceDto], maxItems: 27 })
  @IsArray()
  @ArrayMaxSize(27)
  @ValidateNested({ each: true })
  @Type(() => ChannelPreferenceDto)
  channels!: ChannelPreferenceDto[];

  @ApiProperty()
  @IsBoolean()
  quietEnabled!: boolean;

  /** Minutes depuis minuit, heure locale du profil. */
  @ApiProperty({ minimum: 0, maximum: 1439 })
  @IsInt()
  @Min(0)
  @Max(1439)
  quietStart!: number;

  @ApiProperty({ minimum: 0, maximum: 1439 })
  @IsInt()
  @Min(0)
  @Max(1439)
  quietEnd!: number;

  @ApiProperty({ enum: DIGEST_FREQUENCIES, enumName: 'DigestFrequency' })
  @IsIn(DIGEST_FREQUENCIES)
  digest!: (typeof DIGEST_FREQUENCIES)[number];

  @ApiProperty()
  @IsBoolean()
  sharePresence!: boolean;
}
