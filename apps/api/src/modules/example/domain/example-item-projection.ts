import type { ExampleItem, ExamplePriority, ExampleReservation } from './example-item';

/**
 * Point de vue du lecteur.
 *
 * ⚠ Module type uniquement. Dans les vrais modules, ce choix est fait par le module
 * `visibility` (invariant « un seul juge », QA-04) et le lecteur vient de la session.
 */
export type ExampleViewer = { readonly role: 'recipient' } | { readonly role: 'giver' };

/** Ce qu'un destinataire peut savoir. Aucun champ d'offreur, même facultatif (API-12). */
export interface ExampleRecipientProjection {
  readonly view: 'recipient';
  readonly id: string;
  readonly title: string;
  readonly priority: ExamplePriority;
}

export interface ExampleGiverProjection {
  readonly view: 'giver';
  readonly id: string;
  readonly title: string;
  readonly priority: ExamplePriority;
  readonly reservation: ExampleReservation | null;
}

export type ExampleProjection = ExampleRecipientProjection | ExampleGiverProjection;

/**
 * Projection par construction explicite : on liste les champs permis, on ne retire jamais
 * des champs interdits (une donnée ajoutée plus tard ne fuit pas par défaut).
 */
export function projectExampleItem(item: ExampleItem, viewer: ExampleViewer): ExampleProjection {
  return viewer.role === 'giver' ? projectForGiver(item) : projectForRecipient(item);
}

export function projectForRecipient(item: ExampleItem): ExampleRecipientProjection {
  return { view: 'recipient', id: item.id, title: item.title, priority: item.priority };
}

function projectForGiver(item: ExampleItem): ExampleGiverProjection {
  return {
    view: 'giver',
    id: item.id,
    title: item.title,
    priority: item.priority,
    reservation: item.reservation,
  };
}
