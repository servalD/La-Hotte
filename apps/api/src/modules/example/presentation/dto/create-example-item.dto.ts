import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import {
  EXAMPLE_PRIORITIES,
  EXAMPLE_TITLE_MAX,
  type ExamplePriority,
} from '../../application/contract';

/**
 * Corps de création. API-04 : chaque champ déclare ses contraintes, elles passent dans
 * openapi.json puis dans le schéma Zod généré. Champs inconnus rejetés (SEC-10).
 */
export class CreateExampleItemDto {
  /** Titre affiché du souhait. */
  @IsString()
  @Length(1, EXAMPLE_TITLE_MAX)
  @ApiProperty({ minLength: 1, maxLength: EXAMPLE_TITLE_MAX, example: 'Vélo de route' })
  title: string;

  @IsOptional()
  @IsIn(EXAMPLE_PRIORITIES)
  @ApiProperty({
    enum: EXAMPLE_PRIORITIES,
    enumName: 'ExamplePriority',
    required: false,
    default: 'normal',
  })
  priority?: ExamplePriority;
}
