import { ApiProperty } from '@nestjs/swagger';

/** PRO-12 : le jeton de passage n'est rendu qu'ici, une seule fois. */
export class CreatedTransferView {
  @ApiProperty({ format: 'uuid' })
  transferId!: string;

  /** Passage seulement ; `null` pour un détachement (le lien part à la nouvelle adresse). */
  @ApiProperty({ type: String, nullable: true, format: 'password' })
  token!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}

/** PRO-12, PRO-13 : état d'une demande, vu par le compte d'origine ou par le profil. */
export class TransferView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['MOVE', 'DETACH'] })
  kind!: 'MOVE' | 'DETACH';

  @ApiProperty()
  regroup!: boolean;

  /** PRO-13 : adresse du nouveau compte, montrée sur l'écran d'accord (I3). */
  @ApiProperty({ type: String, format: 'email', nullable: true })
  newEmail!: string | null;

  @ApiProperty()
  profileConsentRequired!: boolean;

  @ApiProperty()
  profileConsented!: boolean;

  @ApiProperty()
  destinationAccepted!: boolean;

  @ApiProperty({ enum: ['KEEP', 'NEW', 'NONE'] })
  pinChoice!: 'KEEP' | 'NEW' | 'NONE';

  /** PRO-12 : 48 heures après le dernier accord ; `null` tant qu'il en manque. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  executesAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}

/** PRO-12 : la demande qui concerne le profil actif, et où il irait. */
export class OwnTransferView extends TransferView {
  /** Profils du compte d'arrivée que le profil connaît (passage accepté). */
  @ApiProperty({ type: [String] })
  destinationNames!: string[];
}

export class OwnTransferStateView {
  @ApiProperty({ type: OwnTransferView, nullable: true })
  transfer!: OwnTransferView | null;
}

/** PRO-12 : profil qui part, vu par le compte d'arrivée avant d'accepter. */
export class TransferPreviewView {
  @ApiProperty({ format: 'uuid' })
  transferId!: string;

  @ApiProperty({ maxLength: 60 })
  profileName!: string;

  @ApiProperty({ type: String, nullable: true })
  avatar!: string | null;

  @ApiProperty({ pattern: '^#[0-9a-f]{6}$' })
  accentColor!: string;

  @ApiProperty()
  isChild!: boolean;
}

export class IncomingTransferView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: 60 })
  profileName!: string;

  @ApiProperty({ pattern: '^#[0-9a-f]{6}$' })
  accentColor!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  executesAt!: string | null;
}

export class IncomingTransferListView {
  @ApiProperty({ type: [IncomingTransferView] })
  items!: IncomingTransferView[];
}
