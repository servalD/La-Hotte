import { ApiProperty } from '@nestjs/swagger';
import {
  EXAMPLE_PRIORITIES,
  EXAMPLE_TITLE_MAX,
  type ExampleGiverProjection,
  type ExamplePriority,
  type ExampleProjection,
  type ExampleRecipientProjection,
} from '../../application/contract';

/**
 * Vue destinataire (API-12). Classe distincte de la vue offreur, sans héritage commun :
 * un champ d'offreur ne peut pas y apparaître par erreur.
 */
export class ExampleItemRecipientView {
  @ApiProperty({ enum: ['recipient'] })
  view: 'recipient';

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ minLength: 1, maxLength: EXAMPLE_TITLE_MAX })
  title: string;

  @ApiProperty({ enum: EXAMPLE_PRIORITIES, enumName: 'ExamplePriority' })
  priority: ExamplePriority;
}

export class ExampleReservationView {
  @ApiProperty({ maxLength: 80 })
  byName: string;

  @ApiProperty({ format: 'date-time' })
  at: string;
}

/** Vue offreur : porte les données que le destinataire ne doit jamais recevoir. */
export class ExampleItemGiverView {
  @ApiProperty({ enum: ['giver'] })
  view: 'giver';

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ minLength: 1, maxLength: EXAMPLE_TITLE_MAX })
  title: string;

  @ApiProperty({ enum: EXAMPLE_PRIORITIES, enumName: 'ExamplePriority' })
  priority: ExamplePriority;

  @ApiProperty({ type: ExampleReservationView, nullable: true })
  reservation: ExampleReservationView | null;
}

export type ExampleItemView = ExampleItemRecipientView | ExampleItemGiverView;

export function toRecipientView(p: ExampleRecipientProjection): ExampleItemRecipientView {
  return { view: 'recipient', id: p.id, title: p.title, priority: p.priority };
}

function toGiverView(p: ExampleGiverProjection): ExampleItemGiverView {
  return {
    view: 'giver',
    id: p.id,
    title: p.title,
    priority: p.priority,
    reservation: p.reservation
      ? { byName: p.reservation.byName, at: p.reservation.at.toISOString() }
      : null,
  };
}

export function toExampleItemView(p: ExampleProjection): ExampleItemView {
  return p.view === 'giver' ? toGiverView(p) : toRecipientView(p);
}
