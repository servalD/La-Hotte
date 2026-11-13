import { ApiProperty } from '@nestjs/swagger';
import { PIN_RELOCK_MODES, type PinRelock } from '../../application/contract';

/**
 * Profil dans l'espace Compte (PIN-08, ADR 0013) : métadonnées seulement. Un test fige cette
 * forme : aucun autre champ n'y entre sans revue.
 */
export class AccountProfileView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: 60 })
  displayName!: string;

  /** Clé d'image ; `null` : couleur d'accent et initiales. */
  @ApiProperty({ type: String, nullable: true })
  avatar!: string | null;

  @ApiProperty({ pattern: '^#[0-9a-f]{6}$' })
  accentColor!: string;

  @ApiProperty()
  hasPin!: boolean;

  @ApiProperty()
  isChild!: boolean;
}

export class AccountProfileListView {
  @ApiProperty({ type: [AccountProfileView] })
  items!: AccountProfileView[];
}

export class BirthdayView {
  @ApiProperty({ minimum: 1, maximum: 31 })
  day!: number;

  @ApiProperty({ minimum: 1, maximum: 12 })
  month!: number;

  @ApiProperty({ type: Number, nullable: true })
  year!: number | null;
}

/** `GET /profiles/me` : le profil actif, vu par lui-même (PRO-02). */
export class ProfileView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: 60 })
  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  avatar!: string | null;

  @ApiProperty({ pattern: '^#[0-9a-f]{6}$' })
  accentColor!: string;

  @ApiProperty({ type: BirthdayView, nullable: true })
  birthday!: BirthdayView | null;

  @ApiProperty({ example: 'fr' })
  locale!: string;

  @ApiProperty({ example: 'EUR' })
  currency!: string;

  @ApiProperty({ example: 'Europe/Paris' })
  timezone!: string;

  @ApiProperty()
  isChild!: boolean;

  @ApiProperty()
  hasPin!: boolean;

  @ApiProperty({ enum: PIN_RELOCK_MODES })
  pinRelock!: PinRelock;

  /**
   * PIN-05 : PIN réinitialisé ou désactivé depuis l'espace Compte ; reste affiché tant que le
   * profil ne s'est pas redonné un PIN (`PUT /profiles/me/pin`).
   */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pinResetNoticeAt!: string | null;

  /** À renvoyer dans `If-Match` pour modifier le profil (API-17). */
  @ApiProperty({ minimum: 1 })
  version!: number;
}

/** `POST /session/profile` (PRO-07). */
export class ProfileSelectionView {
  @ApiProperty({ format: 'uuid' })
  activeProfileId!: string;

  /** Faux : le profil a un PIN et aucun PIN n'a été envoyé. */
  @ApiProperty()
  profileUnlocked!: boolean;

  /**
   * PIN-05 : PIN réinitialisé ou désactivé depuis l'espace Compte, rendu à chaque entrée tant que
   * le profil ne s'est pas redonné un PIN. `null` si le profil reste verrouillé.
   */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pinResetNoticeAt!: string | null;

  /** PIN-03 : PIN faux saisis depuis la dernière entrée dans ce profil. */
  @ApiProperty({ minimum: 0 })
  failedPinAttempts!: number;
}
