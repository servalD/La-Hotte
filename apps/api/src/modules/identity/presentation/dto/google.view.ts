import { ApiProperty } from '@nestjs/swagger';

/** Départ vers Google : le client navigue vers cette URL (ADR 0013, « Retour OIDC »). */
export class GoogleRedirectView {
  @ApiProperty({ format: 'uri' })
  authorizationUrl!: string;
}
