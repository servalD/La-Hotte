import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../application/contract';

// API-04 : contraintes explicites ; champs inconnus refusés (SEC-10).

/** Jeton envoyé par e-mail : 32 octets en base64url (ADR 0013). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** `POST /account/wards` (PRO-15) : compte sous tutelle avec un nouveau profil enfant. */
export class CreateWardDto {
  @IsEmail({ allow_display_name: false, allow_ip_domain: false })
  @MaxLength(EMAIL_MAX_LENGTH)
  @ApiProperty({ format: 'email', maxLength: EMAIL_MAX_LENGTH })
  email!: string;

  /** Nom affiché du profil enfant (PRO-02). */
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  @Matches(/\S/)
  @ApiProperty({ minLength: 1, maxLength: DISPLAY_NAME_MAX_LENGTH })
  profileName!: string;

  /** RGPD-06 : case « J'ai l'autorité parentale », non précochée. Seule `true` est acceptée. */
  @Equals(true)
  @ApiProperty({ type: Boolean, enum: [true] })
  guardianAttested!: true;
}

/** `POST /account/wards/{id}/profiles` (PRO-16) : profil enfant ajouté par le tuteur. */
export class CreateWardProfileDto {
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  @Matches(/\S/)
  @ApiProperty({ minLength: 1, maxLength: DISPLAY_NAME_MAX_LENGTH })
  displayName!: string;
}

/** `POST /accounts/setup` (PRO-15) : jeton lu dans le fragment du lien, mot de passe choisi. */
export class AccountSetupDto {
  @IsString()
  @Matches(TOKEN_PATTERN)
  @ApiProperty({ pattern: TOKEN_PATTERN.source, minLength: 43, maxLength: 43 })
  token!: string;

  /** AUTH-02 : 12 caractères au moins, sans règle de composition. */
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    format: 'password',
  })
  password!: string;

  /** AUTH-08 : exigé pour un compte détaché (PRO-13) ; sans objet pour un compte sous tutelle. */
  @IsOptional()
  @Equals(true)
  @ApiProperty({ required: false, type: Boolean, enum: [true] })
  ageAttested?: true;
}

/** `POST /account/age-attestation` (AUTH-08, PRO-16) : case « J'ai 15 ans ou plus ». */
export class AgeAttestationDto {
  @Equals(true)
  @ApiProperty({ type: Boolean, enum: [true] })
  ageAttested!: true;
}
