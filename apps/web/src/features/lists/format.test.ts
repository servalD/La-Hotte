import { describe, expect, it } from 'vitest';
import { formatMinor, parseMinor } from './format';

// ART-11 : montants entiers en unités mineures, jamais de flottant dans le calcul.

describe('formatMinor', () => {
  it('3 × 19,99 € = 59,97 € (critère de 02)', () => {
    expect(formatMinor(1999 * 3, 'EUR', 'fr')).toBe('59,97\u00a0€');
  });
  it('devise sans décimales', () => {
    expect(formatMinor(1299, 'JPY', 'en')).toBe('¥1,299');
  });
});

describe('parseMinor', () => {
  it.each([
    ['19,99', 1999],
    ['19.9', 1990],
    ['20', 2000],
    ['abc', null],
    ['1,234', null],
  ])('%s → %s', (input, expected) => {
    expect(parseMinor(input, 'EUR', 'fr')).toBe(expected);
  });
});
