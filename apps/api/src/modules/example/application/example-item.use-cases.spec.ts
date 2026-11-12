import { Clock, IdGenerator } from '../../../shared/domain';
import { ExampleItem } from '../domain/example-item';
import { ExampleItemNotFoundError, InvalidExampleTitleError } from '../domain/example-item.errors';
import { InMemoryExampleItemRepository } from '../infrastructure/in-memory-example-item.repository';
import { CreateExampleItem } from './create-example-item.use-case';
import { GetExampleItem } from './get-example-item.use-case';

class FixedIds extends IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `id-${this.n}`;
  }
}

class FixedClock extends Clock {
  constructor(private readonly at: Date) {
    super();
  }
  now(): Date {
    return this.at;
  }
}

const now = new Date('2026-11-12T10:00:00Z');

describe('CreateExampleItem', () => {
  it('crée, enregistre et renvoie la vue destinataire', async () => {
    const repo = new InMemoryExampleItemRepository();
    const useCase = new CreateExampleItem(repo, new FixedIds(), new FixedClock(now));

    const view = await useCase.execute({ title: 'Vélo', priority: 'high' });

    expect(view).toEqual({ view: 'recipient', id: 'id-1', title: 'Vélo', priority: 'high' });
    expect((await repo.findById('id-1'))?.title).toBe('Vélo');
  });

  it('propage l’erreur métier sans rien enregistrer', async () => {
    const repo = new InMemoryExampleItemRepository();
    const useCase = new CreateExampleItem(repo, new FixedIds(), new FixedClock(now));

    await expect(useCase.execute({ title: ' ' })).rejects.toBeInstanceOf(InvalidExampleTitleError);
    expect(repo.size).toBe(0);
  });
});

describe('GetExampleItem', () => {
  it('SEC-04 : introuvable produit une erreur not_found', async () => {
    const useCase = new GetExampleItem(new InMemoryExampleItemRepository());
    await expect(
      useCase.execute({ id: 'absent', viewer: { role: 'recipient' } }),
    ).rejects.toBeInstanceOf(ExampleItemNotFoundError);
  });

  it('VIS-20 : renvoie la projection du lecteur', async () => {
    const repo = new InMemoryExampleItemRepository();
    await repo.save(
      ExampleItem.restore({
        id: 'id-1',
        title: 'Vélo',
        priority: 'normal',
        reservation: { byName: 'Tante Marie', at: now },
        version: 1,
        createdAt: now,
      }),
    );
    const useCase = new GetExampleItem(repo);

    const recipient = await useCase.execute({ id: 'id-1', viewer: { role: 'recipient' } });
    const giver = await useCase.execute({ id: 'id-1', viewer: { role: 'giver' } });

    expect(recipient).not.toHaveProperty('reservation');
    expect(giver).toHaveProperty('reservation.byName', 'Tante Marie');
  });
});
