import { ApiProperty } from '@nestjs/swagger';
import { AccountProfileView } from './profile.view';

/**
 * Compte sous tutelle vu par son tuteur (PRO-16, PIN-08) : métadonnées seulement. Un test fige
 * cette forme : aucun champ de liste, d'élément ni d'offreur n'y entre.
 */
export class WardView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  /** Levée demandée, en attente de la déclaration d'âge du compte. */
  @ApiProperty()
  releaseRequested!: boolean;

  @ApiProperty({ type: [AccountProfileView] })
  profiles!: AccountProfileView[];
}

export class WardListView {
  @ApiProperty({ type: [WardView] })
  items!: WardView[];
}

/** Session d'un compte sous tutelle : appareil et dernière activité (AUTH-05). */
export class WardSessionView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: 512 })
  userAgent!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  lastSeenAt!: string;
}

export class WardDetailView extends WardView {
  @ApiProperty({ type: [WardSessionView] })
  sessions!: WardSessionView[];
}

export class CreatedWardProfileView {
  @ApiProperty({ format: 'uuid' })
  profileId!: string;
}
