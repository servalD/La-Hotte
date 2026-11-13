import { ApiProperty } from '@nestjs/swagger';
import { SessionStatusView } from './session-status.view';

/**
 * Inscription au TOTP (AUTH-10) : secret et URI `otpauth://` pour le QR code, renvoyés une seule
 * fois. Le client dessine le QR code lui-même : le secret ne part vers aucun service tiers.
 */
export class TotpEnrollmentView {
  @ApiProperty({ description: 'Secret base32, pour une saisie à la main.' })
  secret!: string;

  @ApiProperty({ description: 'URI otpauth:// à afficher en QR code.' })
  otpauthUri!: string;
}

/** AUTH-10 : codes de secours, affichés une seule fois. */
export class RecoveryCodesView {
  @ApiProperty({ type: [String], minItems: 10, maxItems: 10, example: ['7K2M-9QXA-4T0P-ZR8H'] })
  recoveryCodes!: string[];
}

/**
 * Activation du TOTP (AUTH-05, AUTH-10) : toutes les sessions sont tombées ; voici la session neuve
 * de l'appelant (cookies posés) et ses codes de secours, affichés une seule fois.
 */
export class TotpActivationView extends SessionStatusView {
  @ApiProperty({ type: [String], minItems: 10, maxItems: 10, example: ['7K2M-9QXA-4T0P-ZR8H'] })
  recoveryCodes!: string[];
}

/** `GET /account` : métadonnées du compte seulement (PIN-08, ADR 0013). */
export class AccountView {
  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  emailVerified!: boolean;

  @ApiProperty()
  hasPassword!: boolean;

  /** La ré-authentification demande alors un code (AUTH-14). */
  @ApiProperty()
  totpEnabled!: boolean;

  @ApiProperty({ minimum: 0, maximum: 10 })
  recoveryCodesRemaining!: number;
}

/** Appareil de confiance (AUTH-12), sans jeton ni hash. */
export class TrustedDeviceView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: 512 })
  userAgent!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  /** Appareil de ce navigateur. */
  @ApiProperty()
  current!: boolean;
}

export class TrustedDeviceListView {
  @ApiProperty({ type: [TrustedDeviceView] })
  items!: TrustedDeviceView[];
}
