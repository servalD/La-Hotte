import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
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
  CUSTOM_AUDIENCE_MAX,
  ITEM_NOTE_MAX,
  ITEM_QUANTITY_MAX,
  LIST_DESCRIPTION_MAX,
  LIST_RECIPIENTS_MAX,
  LIST_TITLE_MAX,
} from '../../application/contract';

// API-04 : contraintes explicites ; champs inconnus refusés.

export const LIST_TYPES = ['WISHLIST', 'GIFTLIST'] as const;
/** `EVENT` viendra avec la phase 3. */
export const LIST_AUDIENCES = ['MEMBERS', 'CIRCLE', 'CUSTOM'] as const;
export const VISIBILITY_MODES = ['ALL', 'ONLY', 'EXCEPT'] as const;
export const VISIBILITY_EDIT_ROLES = ['CREATOR', 'OWNER', 'CONTRIBUTOR'] as const;
export const GIFT_EXISTENCES = ['HIDDEN', 'REVEALED'] as const;
export const GIFT_CONTENTS = ['NONE', 'PARTIAL', 'FULL'] as const;
export const MEMBER_ROLES = ['OWNER', 'CONTRIBUTOR', 'READER'] as const;
export const ITEM_PRIORITIES = ['WANT', 'LOVE', 'MUST'] as const;
export const ITEM_SORTS = ['position', 'priority', 'price', 'added'] as const;
export const LIST_SCOPES = ['active', 'archived', 'trash'] as const;
export const WITHDRAWN_REASONS = ['ALREADY_HAVE', 'NO_LONGER_WANTED'] as const;

const PRICE_MAX = 1_000_000_000_00;

export class ListsQueryDto {
  @IsOptional()
  @IsIn(LIST_SCOPES)
  @ApiProperty({ required: false, enum: LIST_SCOPES, enumName: 'ListScope', default: 'active' })
  scope?: (typeof LIST_SCOPES)[number];
}

/** `POST /lists` (LST-01, LST-07, VIS-01, GFT-03). */
export class CreateListDto {
  @IsIn(LIST_TYPES)
  @ApiProperty({ enum: LIST_TYPES, enumName: 'ListType' })
  type!: (typeof LIST_TYPES)[number];

  @IsString()
  @Length(1, LIST_TITLE_MAX)
  @Matches(/\S/)
  @ApiProperty({ minLength: 1, maxLength: LIST_TITLE_MAX })
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIST_DESCRIPTION_MAX)
  @ApiProperty({ required: false, maxLength: LIST_DESCRIPTION_MAX })
  description?: string;

  /** Wishlist : soi-même par défaut ; giftlist : obligatoire. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LIST_RECIPIENTS_MAX)
  @IsUUID('all', { each: true })
  @ApiProperty({ required: false, type: [String], format: 'uuid', maxItems: LIST_RECIPIENTS_MAX })
  recipientIds?: string[];

  @IsOptional()
  @IsIn(LIST_AUDIENCES)
  @ApiProperty({ required: false, enum: LIST_AUDIENCES, enumName: 'ListAudienceChoice' })
  audience?: (typeof LIST_AUDIENCES)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CUSTOM_AUDIENCE_MAX)
  @IsUUID('all', { each: true })
  @ApiProperty({ required: false, type: [String], format: 'uuid', maxItems: CUSTOM_AUDIENCE_MAX })
  customAudience?: string[];

  @IsOptional()
  @IsIn(GIFT_EXISTENCES)
  @ApiProperty({ required: false, enum: GIFT_EXISTENCES, enumName: 'GiftExistence' })
  giftExistence?: (typeof GIFT_EXISTENCES)[number];

  @IsOptional()
  @IsIn(GIFT_CONTENTS)
  @ApiProperty({ required: false, enum: GIFT_CONTENTS, enumName: 'GiftContent' })
  giftContent?: (typeof GIFT_CONTENTS)[number];
}

/** `PATCH /lists/{id}` ; `If-Match` exigé (API-17). */
export class UpdateListDto {
  @IsOptional()
  @IsString()
  @Length(1, LIST_TITLE_MAX)
  @Matches(/\S/)
  @ApiProperty({ required: false, minLength: 1, maxLength: LIST_TITLE_MAX })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIST_DESCRIPTION_MAX)
  @ApiProperty({ required: false, maxLength: LIST_DESCRIPTION_MAX })
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LIST_RECIPIENTS_MAX)
  @IsUUID('all', { each: true })
  @ApiProperty({ required: false, type: [String], format: 'uuid', maxItems: LIST_RECIPIENTS_MAX })
  recipientIds?: string[];

  @IsOptional()
  @IsIn(LIST_AUDIENCES)
  @ApiProperty({ required: false, enum: LIST_AUDIENCES, enumName: 'ListAudienceChoice' })
  audience?: (typeof LIST_AUDIENCES)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CUSTOM_AUDIENCE_MAX)
  @IsUUID('all', { each: true })
  @ApiProperty({ required: false, type: [String], format: 'uuid', maxItems: CUSTOM_AUDIENCE_MAX })
  customAudience?: string[];

  /** LST-03 */
  @IsOptional()
  @IsIn(VISIBILITY_MODES)
  @ApiProperty({ required: false, enum: VISIBILITY_MODES, enumName: 'VisibilityMode' })
  defaultItemVisibility?: (typeof VISIBILITY_MODES)[number];

  /** LST-03 : par l'autorité seule. */
  @IsOptional()
  @IsIn(VISIBILITY_EDIT_ROLES)
  @ApiProperty({ required: false, enum: VISIBILITY_EDIT_ROLES, enumName: 'VisibilityEditRole' })
  visibilityEditRole?: (typeof VISIBILITY_EDIT_ROLES)[number];

  @IsOptional()
  @IsIn(GIFT_EXISTENCES)
  @ApiProperty({ required: false, enum: GIFT_EXISTENCES, enumName: 'GiftExistence' })
  giftExistence?: (typeof GIFT_EXISTENCES)[number];

  @IsOptional()
  @IsIn(GIFT_CONTENTS)
  @ApiProperty({ required: false, enum: GIFT_CONTENTS, enumName: 'GiftContent' })
  giftContent?: (typeof GIFT_CONTENTS)[number];

  /** LST-05 */
  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  archived?: boolean;
}

/** `PUT /lists/{id}/members/{profileId}` (LST-08). */
export class SetMemberDto {
  @IsIn(MEMBER_ROLES)
  @ApiProperty({ enum: MEMBER_ROLES, enumName: 'MemberRoleChoice' })
  role!: (typeof MEMBER_ROLES)[number];
}

/** `POST /lists/{id}/leave` (LST-04) : le créateur désigne son successeur. */
export class LeaveListDto {
  @IsOptional()
  @IsUUID()
  @ApiProperty({ required: false, format: 'uuid' })
  successorProfileId?: string;
}

export class ItemsQueryDto {
  @IsOptional()
  @IsIn(ITEM_SORTS)
  @ApiProperty({ required: false, enum: ITEM_SORTS, enumName: 'ItemSort', default: 'position' })
  sort?: (typeof ITEM_SORTS)[number];
}

/** `POST /lists/{id}/items` : une fiche du profil actif (ART-05). */
export class AddItemDto {
  @IsUUID()
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ITEM_QUANTITY_MAX)
  @ApiProperty({ required: false, minimum: 1, maximum: ITEM_QUANTITY_MAX, default: 1 })
  quantity?: number;

  /** Par défaut, le prix de la fiche (ART-03). */
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(PRICE_MAX)
  @ApiProperty({ type: Number, required: false, nullable: true, minimum: 0, maximum: PRICE_MAX })
  unitPriceMinor?: number | null;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  @ApiProperty({ required: false, pattern: '^[A-Z]{3}$' })
  currency?: string;

  @IsOptional()
  @IsIn(ITEM_PRIORITIES)
  @ApiProperty({ required: false, enum: ITEM_PRIORITIES, enumName: 'ItemPriority' })
  priority?: (typeof ITEM_PRIORITIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(ITEM_NOTE_MAX)
  @ApiProperty({ required: false, maxLength: ITEM_NOTE_MAX })
  note?: string;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  manyWelcome?: boolean;

  /** WSH-04 : suggestion d'un offreur sur une wishlist. */
  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  isSuggestion?: boolean;

  /** GFT-02 : giftlist seulement. */
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID()
  @ApiProperty({ type: String, required: false, nullable: true, format: 'uuid' })
  intendedRecipientId?: string | null;

  /** GFT-03 (`PARTIEL`) : giftlist seulement. */
  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  shownToRecipient?: boolean;
}

/** `PATCH /items/{id}` ; `If-Match` exigé (API-17). */
export class UpdateItemDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ITEM_QUANTITY_MAX)
  @ApiProperty({ required: false, minimum: 1, maximum: ITEM_QUANTITY_MAX })
  quantity?: number;

  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(PRICE_MAX)
  @ApiProperty({ type: Number, required: false, nullable: true, minimum: 0, maximum: PRICE_MAX })
  unitPriceMinor?: number | null;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  @ApiProperty({ required: false, pattern: '^[A-Z]{3}$' })
  currency?: string;

  @IsOptional()
  @IsIn(ITEM_PRIORITIES)
  @ApiProperty({ required: false, enum: ITEM_PRIORITIES, enumName: 'ItemPriority' })
  priority?: (typeof ITEM_PRIORITIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(ITEM_NOTE_MAX)
  @ApiProperty({ required: false, maxLength: ITEM_NOTE_MAX })
  note?: string;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  manyWelcome?: boolean;

  /** LST-06 : ordre manuel. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  @ApiProperty({ required: false, minimum: 0, maximum: 100_000 })
  position?: number;

  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID()
  @ApiProperty({ type: String, required: false, nullable: true, format: 'uuid' })
  intendedRecipientId?: string | null;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  shownToRecipient?: boolean;
}

/** `POST /items/{id}/withdraw` (LST-15). */
export class WithdrawItemDto {
  @IsIn(WITHDRAWN_REASONS)
  @ApiProperty({ enum: WITHDRAWN_REASONS, enumName: 'WithdrawnReason' })
  reason!: (typeof WITHDRAWN_REASONS)[number];
}
