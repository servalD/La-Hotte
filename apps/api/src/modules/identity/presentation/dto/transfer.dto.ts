import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  EMAIL_MAX_LENGTH,
  INVITATION_TOKEN_PATTERN,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
} from '../../application/contract';

// API-04 : contraintes explicites ; champs inconnus refusés (SEC-10).

const PIN_CHOICES = ['KEEP', 'NEW', 'NONE'] as const;
/** Jeton envoyé par e-mail : 32 octets en base64url (ADR 0013). */
const MAIL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

class NewPinFields {
  /**
   * PRO-12 : `KEEP` garder son PIN, `NEW` en fixer un (`newPin`), `NONE` n'en avoir aucun
   * (jamais par défaut, efface le PIN existant).
   */
  @IsIn(PIN_CHOICES)
  @ApiProperty({ enum: PIN_CHOICES })
  pinChoice!: (typeof PIN_CHOICES)[number];

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]+$/)
  @Length(PIN_MIN_LENGTH, PIN_MAX_LENGTH)
  @ApiProperty({
    required: false,
    pattern: '^[0-9]+$',
    minLength: PIN_MIN_LENGTH,
    maxLength: PIN_MAX_LENGTH,
    format: 'password',
  })
  newPin?: string;
}

/** `POST /account/profiles/{id}/transfer` (PRO-12, PRO-13). */
export class RequestTransferDto {
  @IsIn(['MOVE', 'DETACH'])
  @ApiProperty({ enum: ['MOVE', 'DETACH'] })
  kind!: 'MOVE' | 'DETACH';

  /** PRO-12 : regroupement déclaré (dernier profil du compte, qui disparaît). */
  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, default: false })
  regroup?: boolean;

  /** PRO-13 : adresse du nouveau compte (détachement seulement). */
  @IsOptional()
  @IsEmail({ allow_display_name: false, allow_ip_domain: false })
  @MaxLength(EMAIL_MAX_LENGTH)
  @ApiProperty({ required: false, format: 'email', maxLength: EMAIL_MAX_LENGTH })
  email?: string;

  /** Par défaut : garder son PIN s'il en a un, sinon en fixer un. */
  @IsOptional()
  @IsIn(PIN_CHOICES)
  @ApiProperty({ required: false, enum: PIN_CHOICES })
  pinChoice?: (typeof PIN_CHOICES)[number];

  /** Nouveau PIN d'un profil dont l'accord n'est pas demandé (enfant). */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]+$/)
  @Length(PIN_MIN_LENGTH, PIN_MAX_LENGTH)
  @ApiProperty({
    required: false,
    pattern: '^[0-9]+$',
    minLength: PIN_MIN_LENGTH,
    maxLength: PIN_MAX_LENGTH,
    format: 'password',
  })
  newPin?: string;
}

/** `POST /profiles/me/transfer/consent` (PRO-12). */
export class TransferConsentDto extends NewPinFields {}

/** `POST /transfers/consent` (PRO-12) : par le lien envoyé à l'adresse du profil. */
export class TransferConsentByEmailDto extends NewPinFields {
  @IsString()
  @Matches(MAIL_TOKEN_PATTERN)
  @ApiProperty({ pattern: MAIL_TOKEN_PATTERN.source, minLength: 43, maxLength: 43 })
  token!: string;
}

/** `POST /transfers/cancel` (PRO-12). */
export class TransferCancelDto {
  @IsString()
  @Matches(MAIL_TOKEN_PATTERN)
  @ApiProperty({ pattern: MAIL_TOKEN_PATTERN.source, minLength: 43, maxLength: 43 })
  token!: string;
}

/** `POST /account/transfers/inspect` et `/accept` (PRO-12) : jeton de passage (128 bits). */
export class TransferTokenDto {
  @Matches(INVITATION_TOKEN_PATTERN)
  @ApiProperty({ pattern: INVITATION_TOKEN_PATTERN.source, format: 'password' })
  token!: string;
}
