import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import { ExampleItem, type ExamplePriority } from '../domain/example-item';
import {
  type ExampleRecipientProjection,
  projectForRecipient,
} from '../domain/example-item-projection';
import { ExampleItemRepository } from '../domain/example-item.repository';

export interface CreateExampleItemInput {
  readonly title: string;
  readonly priority?: ExamplePriority;
}

/**
 * Un cas d'usage = une classe = un fichier, une méthode `execute` (ADR 0002).
 * Il orchestre : il ne contient pas de règle (elles sont dans l'entité) ni d'accès direct à la base.
 */
@Injectable()
export class CreateExampleItem {
  constructor(
    private readonly items: ExampleItemRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateExampleItemInput): Promise<ExampleRecipientProjection> {
    const item = ExampleItem.create({
      id: this.ids.next(),
      title: input.title,
      ...(input.priority ? { priority: input.priority } : {}),
      now: this.clock.now(),
    });
    await this.items.save(item);
    // Le créateur est ici le destinataire : il reçoit la vue destinataire.
    return projectForRecipient(item);
  }
}
