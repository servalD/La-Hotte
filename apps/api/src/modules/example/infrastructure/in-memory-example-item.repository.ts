import { ExampleItem } from '../domain/example-item';
import { ExampleItemRepository } from '../domain/example-item.repository';

/** Adaptateur en mémoire : tests de cas d'usage et tests de contrat, sans base. */
export class InMemoryExampleItemRepository extends ExampleItemRepository {
  private readonly rows = new Map<string, ExampleItem>();

  get size(): number {
    return this.rows.size;
  }

  findById(id: string): Promise<ExampleItem | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  save(item: ExampleItem): Promise<void> {
    this.rows.set(item.id, item);
    return Promise.resolve();
  }
}
