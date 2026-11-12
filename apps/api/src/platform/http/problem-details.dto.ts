import { ApiProperty } from '@nestjs/swagger';

export class FieldErrorDto {
  /** Chemin du champ, en notation pointée (`items.0.title`). */
  @ApiProperty({ example: 'title' })
  field: string;

  /** Code stable de la contrainte non respectée. */
  @ApiProperty({ example: 'isLength' })
  code: string;

  @ApiProperty({ example: 'title doit contenir entre 1 et 120 caractères' })
  message: string;
}

/** Erreur au format `application/problem+json` (RFC 9457, API-14). */
export class ProblemDetailsDto {
  @ApiProperty({ example: 'about:blank' })
  type: string;

  @ApiProperty({ example: 'Requête invalide' })
  title: string;

  @ApiProperty({ example: 400, minimum: 400, maximum: 599 })
  status: number;

  /** Code stable, exploitable par le client. */
  @ApiProperty({ example: 'VALIDATION_FAILED' })
  code: string;

  @ApiProperty({ required: false })
  detail?: string;

  /** Identifiant de la requête, à citer pour un signalement. */
  @ApiProperty({ required: false })
  requestId?: string;

  @ApiProperty({ type: [FieldErrorDto], required: false })
  errors?: FieldErrorDto[];
}
