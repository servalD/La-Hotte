import { ApiProperty } from '@nestjs/swagger';

/** Session courante, sans jeton ni hash (ADR 0013 : seul `id` sort du serveur). */
export class SessionSummaryView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  activeProfileId!: string | null;

  /** Profil actif présent et déverrouillé (PIN-02). */
  @ApiProperty()
  profileUnlocked!: boolean;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

/** `GET /session` (API-21) : état de session et jeton CSRF à renvoyer dans `X-CSRF-Token`. */
export class SessionStatusView {
  @ApiProperty()
  authenticated!: boolean;

  @ApiProperty({ description: 'À renvoyer dans l’en-tête X-CSRF-Token de chaque mutation.' })
  csrfToken!: string;

  @ApiProperty({ type: SessionSummaryView, nullable: true })
  session!: SessionSummaryView | null;

  /**
   * Mot de passe validé, second facteur attendu (AUTH-12) : le client affiche la saisie du code
   * (`POST /auth/totp/verify`). Expire en 5 minutes.
   */
  @ApiProperty()
  secondFactorPending!: boolean;
}
