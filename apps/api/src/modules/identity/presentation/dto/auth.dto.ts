import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsTimeZone,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  INVITATION_TOKEN_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../application/contract';

// API-04 : contraintes explicites, reprises dans openapi.json puis dans le Zod généré. Champs
// inconnus refusés (SEC-10). Aucune valeur reçue n'est renvoyée dans un message d'erreur.

/** Jeton envoyé par e-mail : 32 octets en base64url (ADR 0013). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class RegisterDto {
  @IsEmail({ allow_display_name: false, allow_ip_domain: false })
  @MaxLength(EMAIL_MAX_LENGTH)
  @ApiProperty({ format: 'email', maxLength: EMAIL_MAX_LENGTH })
  email!: string;

  /** AUTH-02 : 12 caractères au moins, sans règle de composition. */
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    format: 'password',
  })
  password!: string;

  /** Nom affiché du premier profil (PRO-01, PRO-02). */
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  @Matches(/\S/)
  @ApiProperty({ minLength: 1, maxLength: DISPLAY_NAME_MAX_LENGTH })
  displayName!: string;

  /** AUTH-08 : case « J'ai 15 ans ou plus », non précochée. Seule la valeur `true` est acceptée. */
  @Equals(true)
  @ApiProperty({ type: Boolean, enum: [true] })
  ageAttested!: true;

  /** Langue du navigateur ; à défaut, français. */
  @IsOptional()
  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/)
  @ApiProperty({ required: false, pattern: '^[a-z]{2}(-[A-Z]{2})?$', example: 'fr' })
  locale?: string;

  /** Fuseau IANA du navigateur ; à défaut, Europe/Paris. */
  @IsOptional()
  @IsTimeZone()
  @MaxLength(64)
  @ApiProperty({ required: false, maxLength: 64, example: 'Europe/Paris' })
  timezone?: string;

  /** LNK-08, AUTH-09 : jeton d'invitation (obligatoire en `INVITE_ONLY`). */
  @IsOptional()
  @Matches(INVITATION_TOKEN_PATTERN)
  @ApiProperty({ required: false, pattern: INVITATION_TOKEN_PATTERN.source })
  invitationToken?: string;
}

/** Connexion : aucune règle de forme sur le mot de passe, pour ne rien dire de la politique. */
export class LoginDto {
  @IsString()
  @Length(3, EMAIL_MAX_LENGTH)
  @ApiProperty({ minLength: 3, maxLength: EMAIL_MAX_LENGTH })
  email!: string;

  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  @ApiProperty({ minLength: 1, maxLength: PASSWORD_MAX_LENGTH, format: 'password' })
  password!: string;
}

/**
 * Code du second facteur : 6 chiffres TOTP, ou code de secours (16 caractères, tirets et espaces
 * tolérés). La forme exacte est vérifiée par le domaine ; ici, une borne.
 */
const SECOND_FACTOR_CODE = /^[0-9A-Za-z -]{6,32}$/;

export class ReauthDto {
  /**
   * Absent seulement après un retour de Google qui attend le code TOTP
   * (`reauth_second_factor`, AUTH-14).
   */
  @IsOptional()
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  @ApiProperty({
    required: false,
    minLength: 1,
    maxLength: PASSWORD_MAX_LENGTH,
    format: 'password',
  })
  password?: string;

  /** AUTH-14 : exigé si le TOTP est actif (code TOTP ou de secours). */
  @IsOptional()
  @IsString()
  @Matches(SECOND_FACTOR_CODE)
  @ApiProperty({ required: false, pattern: SECOND_FACTOR_CODE.source, minLength: 6, maxLength: 32 })
  code?: string;
}

/** Second facteur à la connexion (AUTH-10, AUTH-12). */
export class SecondFactorDto {
  @IsString()
  @Matches(SECOND_FACTOR_CODE)
  @ApiProperty({ pattern: SECOND_FACTOR_CODE.source, minLength: 6, maxLength: 32 })
  code!: string;

  /** « Faire confiance à cet appareil 30 jours » (AUTH-12). */
  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, default: false })
  trustDevice?: boolean;
}

/** Confirmation de l'activation du TOTP : un code de l'application, 6 chiffres. */
export class TotpCodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  @ApiProperty({ pattern: '^\\d{6}$', minLength: 6, maxLength: 6 })
  code!: string;
}

export class EmailDto {
  @IsEmail({ allow_display_name: false, allow_ip_domain: false })
  @MaxLength(EMAIL_MAX_LENGTH)
  @ApiProperty({ format: 'email', maxLength: EMAIL_MAX_LENGTH })
  email!: string;
}

/** Jeton lu dans le fragment du lien, envoyé dans le corps (ADR 0013). */
export class EmailTokenDto {
  @IsString()
  @Matches(TOKEN_PATTERN)
  @ApiProperty({ pattern: TOKEN_PATTERN.source, minLength: 43, maxLength: 43 })
  token!: string;
}

export class NewPasswordDto {
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    format: 'password',
  })
  newPassword!: string;
}

export class PasswordResetConfirmDto extends NewPasswordDto {
  @IsString()
  @Matches(TOKEN_PATTERN)
  @ApiProperty({ pattern: TOKEN_PATTERN.source, minLength: 43, maxLength: 43 })
  token!: string;
}

/** AUTH-03, AUTH-08 : inscription par Google, saisie avant le départ vers Google. */
export class GoogleRegistrationDto {
  /** Nom affiché du premier profil (PRO-01, PRO-02). */
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  @Matches(/\S/)
  @ApiProperty({ minLength: 1, maxLength: DISPLAY_NAME_MAX_LENGTH })
  displayName!: string;

  /** AUTH-08 : case « J'ai 15 ans ou plus », non précochée. Seule la valeur `true` est acceptée. */
  @Equals(true)
  @ApiProperty({ type: Boolean, enum: [true] })
  ageAttested!: true;

  @IsOptional()
  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/)
  @ApiProperty({ required: false, pattern: '^[a-z]{2}(-[A-Z]{2})?$', example: 'fr' })
  locale?: string;

  @IsOptional()
  @IsTimeZone()
  @MaxLength(64)
  @ApiProperty({ required: false, maxLength: 64, example: 'Europe/Paris' })
  timezone?: string;

  /** LNK-08, AUTH-09 : jeton d'invitation (obligatoire en `INVITE_ONLY`). */
  @IsOptional()
  @Matches(INVITATION_TOKEN_PATTERN)
  @ApiProperty({ required: false, pattern: INVITATION_TOKEN_PATTERN.source })
  invitationToken?: string;
}

/** Départ vers Google pour se connecter, ou s'inscrire si `registration` est fourni (AUTH-03). */
export class GoogleStartDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => GoogleRegistrationDto)
  @ApiProperty({ required: false, type: GoogleRegistrationDto })
  registration?: GoogleRegistrationDto;
}
