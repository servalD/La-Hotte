import { describe, expect, it } from 'vitest';
import { DOMAIN_ERROR_KINDS } from '../../shared/domain';
import { METRIC_ATTRIBUTE_ALLOW_LIST, portMetricAttributes } from './scrub';

describe('étiquettes de métriques, liste blanche (OBS-02, OBS-20)', () => {
  it('garde un code stable et une nature d’erreur', () => {
    expect(portMetricAttributes({ code: 'LIST_NOT_VISIBLE', kind: 'not_found' })).toEqual({
      code: 'LIST_NOT_VISIBLE',
      kind: 'not_found',
    });
    for (const kind of DOMAIN_ERROR_KINDS) expect(portMetricAttributes({ kind })).toEqual({ kind });
  });

  it('retire une clé hors liste, quelle que soit sa valeur', () => {
    expect(
      portMetricAttributes({
        code: 'OK',
        liste: 'Vélo pour Marie',
        'url.full': 'https://x',
        profil: 'p1',
        status: 404,
      }),
    ).toEqual({ code: 'OK' });
  });

  it('retire une valeur qui n’a pas la forme attendue', () => {
    expect(portMetricAttributes({ code: 'Vélo pour Marie' })).toEqual({});
    expect(portMetricAttributes({ code: 'list_not_visible' })).toEqual({});
    expect(portMetricAttributes({ code: 'A'.repeat(65) })).toEqual({});
    expect(portMetricAttributes({ kind: 'Vélo' })).toEqual({});
  });

  it('n’admet aucun nombre : un petit montant en unités mineures ne passe pas', () => {
    for (const amount of [350, 404, 599, 123_456_789]) {
      expect(portMetricAttributes({ code: amount, kind: amount, status: amount })).toEqual({});
    }
  });

  it('ne se laisse pas tromper par une clé héritée', () => {
    expect(portMetricAttributes(JSON.parse('{"__proto__": "x", "toString": "y"}'))).toEqual({});
  });

  it('ne contient aucune clé qui porte un hôte, une adresse ou une URL', () => {
    for (const key of METRIC_ATTRIBUTE_ALLOW_LIST) {
      expect(key).not.toMatch(/address|host|url\.(full|path|query)|user|header|port$/);
    }
  });
});
