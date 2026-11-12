import type { ExampleItem } from './example-item';

/**
 * Port du dépôt. Classe abstraite plutôt qu'interface : elle sert aussi de jeton
 * d'injection NestJS sans que le domaine connaisse NestJS.
 */
export abstract class ExampleItemRepository {
  abstract findById(id: string): Promise<ExampleItem | null>;
  abstract save(item: ExampleItem): Promise<void>;
}
