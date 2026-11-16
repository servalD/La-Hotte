import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  EVENT_BUDGET_MAX,
  EVENT_DESCRIPTION_MAX,
  EVENT_HONOREES_MAX,
  EVENT_INVITES_MAX,
  EVENT_LINK_USES_MAX,
  EVENT_PLACE_MAX,
  EVENT_TITLE_MAX,
} from '../../application/contract';

// API-04 : contraintes explicites ; champs inconnus refusés.

export const EVENT_TYPES = ['CHRISTMAS', 'BIRTHDAY', 'BIRTH', 'WEDDING', 'OTHER'] as const;
export const EVENT_MODES = ['EXCHANGE', 'HONOREE'] as const;
export const EVENT_STATUSES = ['UPCOMING', 'DONE', 'CANCELLED'] as const;
export const EVENT_ROLES = ['ORGANIZER', 'PARTICIPANT'] as const;
export const RSVPS = ['PENDING', 'YES', 'MAYBE', 'NO'] as const;
export const RSVP_ANSWERS = ['YES', 'MAYBE', 'NO'] as const;
export const EVENT_SCOPES = ['upcoming', 'past'] as const;

/** EVT-05 : un jour, sans heure. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Jeton de lien : 22 caractères base64url (EVT-16). */
const LINK_TOKEN = /^[A-Za-z0-9_-]{22}$/;

export class EventsQueryDto {
  @IsOptional()
  @IsIn(EVENT_SCOPES)
  @ApiProperty({ required: false, enum: EVENT_SCOPES, enumName: 'EventScope', default: 'upcoming' })
  scope?: (typeof EVENT_SCOPES)[number];
}

/** `POST /events` (EVT-01 à EVT-09). */
export class CreateEventDto {
  @IsString()
  @Length(1, EVENT_TITLE_MAX)
  @Matches(/\S/)
  @ApiProperty({ minLength: 1, maxLength: EVENT_TITLE_MAX })
  title!: string;

  @IsString()
  @Matches(DAY)
  @ApiProperty({ format: 'date', example: '2027-12-24' })
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_PLACE_MAX)
  @ApiProperty({ required: false, maxLength: EVENT_PLACE_MAX })
  place?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_DESCRIPTION_MAX)
  @ApiProperty({ required: false, maxLength: EVENT_DESCRIPTION_MAX })
  description?: string;

  @IsIn(EVENT_TYPES)
  @ApiProperty({ enum: EVENT_TYPES, enumName: 'EventType' })
  type!: (typeof EVENT_TYPES)[number];

  /** Défaut selon le type (`05`, « Valeurs par défaut »). */
  @IsOptional()
  @IsIn(EVENT_MODES)
  @ApiProperty({ required: false, enum: EVENT_MODES, enumName: 'EventMode' })
  mode?: (typeof EVENT_MODES)[number];

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, default: false })
  isSurprise?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(EVENT_BUDGET_MAX)
  @ApiProperty({
    required: false,
    nullable: true,
    type: Number,
    minimum: 1,
    maximum: EVENT_BUDGET_MAX,
  })
  suggestedBudgetMinor?: number | null;

  /** EVT-07 : obligatoire « à l'honneur », interdit en échange. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(EVENT_HONOREES_MAX)
  @IsUUID('all', { each: true })
  @ApiProperty({ required: false, type: [String], format: 'uuid', maxItems: EVENT_HONOREES_MAX })
  honoreeIds?: string[];
}

/** `PATCH /events/{id}` (EVT-39) ; `If-Match` obligatoire. */
export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @Length(1, EVENT_TITLE_MAX)
  @Matches(/\S/)
  @ApiProperty({ required: false, minLength: 1, maxLength: EVENT_TITLE_MAX })
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(DAY)
  @ApiProperty({ required: false, format: 'date' })
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_PLACE_MAX)
  @ApiProperty({ required: false, maxLength: EVENT_PLACE_MAX })
  place?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_DESCRIPTION_MAX)
  @ApiProperty({ required: false, maxLength: EVENT_DESCRIPTION_MAX })
  description?: string;

  @IsOptional()
  @IsIn(EVENT_TYPES)
  @ApiProperty({ required: false, enum: EVENT_TYPES, enumName: 'EventType' })
  type?: (typeof EVENT_TYPES)[number];

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(EVENT_BUDGET_MAX)
  @ApiProperty({
    required: false,
    nullable: true,
    type: Number,
    minimum: 1,
    maximum: EVENT_BUDGET_MAX,
  })
  suggestedBudgetMinor?: number | null;
}

/** EVT-07, EVT-15 */
export class EventProfilesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(EVENT_INVITES_MAX)
  @IsUUID('all', { each: true })
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: EVENT_INVITES_MAX })
  profileIds!: string[];
}

/** EVT-13 */
export class RsvpDto {
  @IsIn(RSVP_ANSWERS)
  @ApiProperty({ enum: RSVP_ANSWERS, enumName: 'RsvpAnswer' })
  rsvp!: (typeof RSVP_ANSWERS)[number];
}

/** EVT-16 */
export class CreateEventLinkDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EVENT_LINK_USES_MAX)
  @ApiProperty({ required: false, minimum: 1, maximum: EVENT_LINK_USES_MAX, default: 20 })
  maxUses?: number;
}

/** EVT-16 : jeton dans le corps, jamais dans l'URL. */
export class EventLinkTokenDto {
  @IsString()
  @Matches(LINK_TOKEN)
  @ApiProperty({ minLength: 22, maxLength: 22 })
  token!: string;
}
