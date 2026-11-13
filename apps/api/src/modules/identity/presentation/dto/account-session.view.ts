import { ApiProperty } from '@nestjs/swagger';

/**
 * Session listée dans l'espace Compte (AUTH-05, PIN-08) : métadonnées seulement. `id` est le seul
 * identifiant exposé ; ni jeton ni hash (ADR 0013).
 */
export class AccountSessionView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  /** Agent utilisateur déclaré par l'appareil, tel quel (512 caractères au plus). */
  @ApiProperty({ maxLength: 512 })
  userAgent!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  /** Dernière activité, à 5 minutes près (ADR 0013). */
  @ApiProperty({ format: 'date-time' })
  lastSeenAt!: string;

  /** Session de la requête. */
  @ApiProperty()
  current!: boolean;
}

export class AccountSessionListView {
  @ApiProperty({ type: [AccountSessionView] })
  items!: AccountSessionView[];
}
