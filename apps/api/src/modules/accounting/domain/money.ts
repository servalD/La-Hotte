/**
 * Invariant 4 : l'argent est un entier en unités mineures, jamais un flottant. Les montants
 * restent sous 10¹² (ADR 0019), bien en deçà des entiers sûrs ; les produits intermédiaires
 * (montant × numérateur) passent par `bigint`.
 */
export const MAX_MINOR = 1_000_000_000_000;

export function isMinor(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_MINOR
  );
}

/** Fraction exacte d'un coût (CPT-53). */
export interface Fraction {
  readonly num: number;
  readonly den: number;
}

/** CPT-53 : saisie en pour cent au centième (`basisPoints` sur 10 000) ou en part (den 2 à 10). */
export function isFraction(value: Fraction): boolean {
  return (
    Number.isInteger(value.num) &&
    Number.isInteger(value.den) &&
    value.num > 0 &&
    value.den > 0 &&
    value.num <= value.den &&
    value.den <= 10_000
  );
}

/** Plancher de `total × num / den`, exact. */
export function floorShare(total: number, share: Fraction): number {
  return Number((BigInt(total) * BigInt(share.num)) / BigInt(share.den));
}
