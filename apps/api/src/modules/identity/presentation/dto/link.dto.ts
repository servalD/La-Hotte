import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH, INVITATION_TOKEN_PATTERN } from '../../application/contract';

// API-04 : contraintes explicites ; champs inconnus refusés (SEC-10). Aucun jeton ni adresse n'est
// renvoyé dans un message d'erreur.

/** LNK-01 : adresse facultative ; sans elle, l'invitation se partage à la main (lien, QR code). */
export class CreateInvitationDto {
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
