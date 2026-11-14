import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  INVITATION_TOKEN_PATTERN,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
} from '../../application/contract';

// API-04 : contraintes explicites ; champs inconnus refusés (SEC-10). Aucun jeton ni adresse n'est
// renvoyé dans un message d'erreur.

/** LNK-01 : adresse facultative ; sans elle, l'invitation se partage à la main (lien, QR code). */
export class CreateInvitationDto {
  @IsOptional()
  @IsEmail({ allow_display_name: false, allow_ip_domain: false })
  @MaxLength(EMAIL_MAX_LENGTH)
  @ApiProperty({ required: false, format: 'email', maxLength: EMAIL_MAX_LENGTH })
  email?: string;

  /** PRO-11 : `PROFILE` invite à créer un profil ; `LINK` par défaut. */
  @IsOptional()
  @IsIn(['LINK', 'PROFILE'])
  @ApiProperty({ required: false, enum: ['LINK', 'PROFILE'], default: 'LINK' })
  kind?: 'LINK' | 'PROFILE';

  /**
   * PRO-11 : profil du cercle de l'invitant dont le compte recevra le profil ; sans lui, le
   * compte de l'invitant. Seulement avec `kind: PROFILE`.
   */
  @IsOptional()
  @IsUUID()
  @ApiProperty({ required: false, format: 'uuid' })
  targetProfileId?: string;

  /** PRO-11 : marqueur enfant du profil à créer. Seulement avec `kind: PROFILE`. */
  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, default: false })
  profileIsChild?: boolean;
}

/** PRO-11 : la personne invitée crée son profil (sans session). */
export class AcceptProfileInvitationDto {
  @Matches(INVITATION_TOKEN_PATTERN)
  @ApiProperty({ pattern: INVITATION_TOKEN_PATTERN.source, format: 'password' })
  token!: string;

  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  @Matches(/\S/)
  @ApiProperty({ minLength: 1, maxLength: DISPLAY_NAME_MAX_LENGTH })
  displayName!: string;

  /** PIN-01 : PIN du profil, dès sa création ; facultatif. */
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
  pin?: string;

  /** PRO-10 : adresse du profil, vérifiée ensuite par un lien ; refusée pour un enfant. */
  @IsOptional()
  @IsEmail({ allow_display_name: false, allow_ip_domain: false })
  @MaxLength(EMAIL_MAX_LENGTH)
  @ApiProperty({ required: false, format: 'email', maxLength: EMAIL_MAX_LENGTH })
  email?: string;
}

/** LNK-07 : jeton d'invitation, tel que reçu dans le lien. */
export class InvitationTokenDto {
  @Matches(INVITATION_TOKEN_PATTERN)
  @ApiProperty({ pattern: INVITATION_TOKEN_PATTERN.source, format: 'password' })
  token!: string;
}

/** LNK-05 : le profil à bloquer, parmi les contreparties d'un lien du profil actif. */
export class BlockProfileDto {
  @IsUUID()
  @ApiProperty({ format: 'uuid' })
  profileId!: string;
}

/** PRO-09 : marqueur « profil enfant », depuis l'espace Compte. */
export class SetChildMarkerDto {
  @IsBoolean()
  @ApiProperty()
  isChild!: boolean;
}
