import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CURRENCY_PATTERN,
  DISPLAY_NAME_MAX_LENGTH,
  LOCALE_PATTERN,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  PIN_RELOCK_MODES,
  type PinRelock,
  TIMEZONE_MAX_LENGTH,
} from '../../application/contract';

// API-04 : contraintes explicites ; champs inconnus refusés (SEC-10). Un PIN n'est jamais renvoyé
// dans un message d'erreur ni journalisé.

/** PIN-01 : 4 à 8 chiffres. */
const PIN_PATTERN = /^[0-9]{4,8}$/;
const PIN_PROPERTY = {
  minLength: PIN_MIN_LENGTH,
  maxLength: PIN_MAX_LENGTH,
  pattern: '^[0-9]{4,8}$',
  format: 'password',
} as const;

/** `POST /session/profile` (PRO-07). */
export class SelectProfileDto {
  @IsUUID()
  @ApiProperty({ format: 'uuid' })
  profileId!: string;

  /** Exigé pour déverrouiller un profil à PIN ; sans lui, le profil devient actif, verrouillé. */
  @IsOptional()
  @IsString()
  @Matches(PIN_PATTERN)
  @ApiProperty({ required: false, ...PIN_PROPERTY })
  pin?: string;
}

/** `PUT /profiles/me/pin` (PIN-04). */
export class SetOwnPinDto {
  /** Exigé si le profil a déjà un PIN. */
  @IsOptional()
  @IsString()
  @Matches(PIN_PATTERN)
  @ApiProperty({ required: false, ...PIN_PROPERTY })
  currentPin?: string;

  @IsString()
  @Matches(PIN_PATTERN)
  @ApiProperty(PIN_PROPERTY)
  newPin!: string;
}

/** `PUT /account/profiles/{id}/pin/reset` (PIN-05). */
export class ResetProfilePinDto {
  @IsString()
  @Matches(PIN_PATTERN)
  @ApiProperty(PIN_PROPERTY)
  newPin!: string;
}

/** `POST /account/profiles` (PRO-08). */
export class CreateProfileDto {
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  @Matches(/\S/)
  @ApiProperty({ minLength: 1, maxLength: DISPLAY_NAME_MAX_LENGTH })
  displayName!: string;

  /** Marqueur « profil enfant » (PRO-05), fixé ici seulement (PRO-03). */
  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, default: false })
  isChild?: boolean;
}

/** Date d'anniversaire (PRO-02) : jour et mois, année facultative. */
export class BirthdayDto {
  @IsInt()
  @Min(1)
  @Max(31)
  @ApiProperty({ minimum: 1, maximum: 31 })
  day!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  @ApiProperty({ minimum: 1, maximum: 12 })
  month!: number;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2200)
  @ApiProperty({ type: Number, required: false, nullable: true, minimum: 1900, maximum: 2200 })
  year?: number | null;
}

/** `PATCH /profiles/me` (PRO-03) : sans marqueur enfant. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  @Matches(/\S/)
  @ApiProperty({ required: false, minLength: 1, maxLength: DISPLAY_NAME_MAX_LENGTH })
  displayName?: string;

  /** `null` efface la date. */
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @ValidateNested()
  @Type(() => BirthdayDto)
  @ApiProperty({ type: BirthdayDto, required: false, nullable: true })
  birthday?: BirthdayDto | null;

  @IsOptional()
  @Matches(LOCALE_PATTERN)
  @ApiProperty({ required: false, pattern: LOCALE_PATTERN.source, example: 'fr' })
  locale?: string;

  @IsOptional()
  @Matches(CURRENCY_PATTERN)
  @ApiProperty({ required: false, pattern: CURRENCY_PATTERN.source, example: 'EUR' })
  currency?: string;

  @IsOptional()
  @IsTimeZone()
  @MaxLength(TIMEZONE_MAX_LENGTH)
  @ApiProperty({ required: false, maxLength: TIMEZONE_MAX_LENGTH, example: 'Europe/Paris' })
  timezone?: string;

  /** PIN-07 : redemande du PIN. */
  @IsOptional()
  @IsIn(PIN_RELOCK_MODES)
  @ApiProperty({ required: false, enum: PIN_RELOCK_MODES })
  pinRelock?: PinRelock;

  /** PRO-03 : exigé pour affaiblir `pinRelock` d'un profil à PIN (compté par PIN-03). */
  @IsOptional()
  @IsString()
  @Matches(PIN_PATTERN)
  @ApiProperty({ required: false, ...PIN_PROPERTY })
  currentPin?: string;
}
