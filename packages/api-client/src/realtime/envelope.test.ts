import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { envelope } from './envelope';

const sample = envelope('item.removed', z.object({ itemId: z.uuid() }).strict());

describe('enveloppe temps réel (API-32)', () => {
  const valid = {
    type: 'item.removed',
    id: '0190f3c2-0000-7000-8000-000000000000',
    seq: 3,
    at: '2026-11-12T10:00:00.000Z',
    data: { itemId: '0190f3c2-0000-7000-8000-000000000001' },
  };

  it('accepte un événement conforme', () => {
    expect(sample.parse(valid)).toEqual(valid);
  });

  it('refuse un champ inattendu (aucun champ d’offreur glissé dans les données)', () => {
    expect(() => sample.parse({ ...valid, data: { ...valid.data, buyer: 'x' } })).toThrow();
  });
});
