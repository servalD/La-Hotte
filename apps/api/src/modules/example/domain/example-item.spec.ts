import { ExampleItem } from './example-item';
import { projectExampleItem } from './example-item-projection';
import { InvalidExampleTitleError } from './example-item.errors';

const now = new Date('2026-11-12T10:00:00Z');

describe('ExampleItem', () => {
  it('nettoie le titre et applique la priorité par défaut', () => {
    const item = ExampleItem.create({ id: 'id-1', title: '  Vélo  ', now });
    expect(item.title).toBe('Vélo');
    expect(item.priority).toBe('normal');
    expect(item.version).toBe(1);
    expect(item.reservation).toBeNull();
    expect(item.createdAt).toEqual(now);
  });

  it.each(['', '   ', 'x'.repeat(121)])('refuse un titre invalide (%#)', (title) => {
    expect(() => ExampleItem.create({ id: 'id-1', title, now })).toThrow(InvalidExampleTitleError);
  });
});

describe('projectExampleItem (modèle du test de non-fuite, VIS-20)', () => {
  const reserved = ExampleItem.restore({
    id: 'id-1',
    title: 'Vélo',
    priority: 'high',
    reservation: { byName: 'Tante Marie', at: now },
    version: 3,
    createdAt: now,
  });

  it('VIS-20 : la vue destinataire ne contient aucun champ d’offreur, pas même vide', () => {
    const view = projectExampleItem(reserved, { role: 'recipient' });
    expect(Object.keys(view).sort()).toEqual(['id', 'priority', 'title', 'view']);
    expect(JSON.stringify(view)).not.toContain('Tante Marie');
  });

  it('la vue offreur expose la réservation', () => {
    const view = projectExampleItem(reserved, { role: 'giver' });
    expect(view).toMatchObject({ view: 'giver', reservation: { byName: 'Tante Marie' } });
  });
});
