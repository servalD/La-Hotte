import { floorShare, type Fraction } from './money';

/**
 * Calcul des parts (CPT-01 à CPT-07, CPT-16 à CPT-18, CPT-53 à CPT-57). Fonctions pures : elles
 * reçoivent l'état d'une fiche et rendent le nouvel état, ou la raison d'un refus. Aucune n'écrit.
 */

export type ContributionMode = 'FULL' | 'PERCENT' | 'FIXED';

export interface Part {
  readonly id: string;
  /** CPT-53 : rang d'arrivée, unique dans la fiche. */
  readonly rank: number;
  readonly mode: ContributionMode;
  /** Présente si et seulement si `PERCENT`. */
  readonly share: Fraction | null;
  /** `null` seulement en `FULL` sans prix (CPT-55). */
  readonly amount: number | null;
}

const byRank = (a: Part, b: Part) => a.rank - b.rank;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const isRelative = (part: Part) => part.mode !== 'FIXED';

/** Somme des montants connus. */
export function covered(parts: readonly Part[]): number {
  return sum(parts.map((part) => part.amount ?? 0));
}

function lcm(a: bigint, b: bigint): bigint {
  let x = a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return (a / x) * b;
}

/** CPT-53 : les fractions couvrent-elles exactement `rest` sur `total` ? (calcul rationnel exact) */
function fractionsCoverExactly(total: number, rest: number, shares: readonly Fraction[]): boolean {
  if (shares.length === 0 || total === 0) return false;
  const den = shares.reduce((acc, share) => lcm(acc, BigInt(share.den)), 1n);
  const num = shares.reduce(
    (acc, share) => acc + BigInt(share.num) * (den / BigInt(share.den)),
    0n,
  );
  return num * BigInt(total) === BigInt(rest) * den;
}

/**
 * Montants avant l'achat, à coût prévu donné (CPT-07, CPT-53, CPT-54, CPT-55). Les montants
 * fixes sont gardés ; chaque pourcentage vaut le plancher de sa fraction du coût ; la part Tout
 * complète (elle peut sortir négative : à l'appelant de refuser ou de réduire) ; sans part
 * Tout, les centimes perdus vont un par un aux pourcentages, par rang, si et seulement si les
 * fractions couvrent exactement ce que laissent les montants fixes.
 */
export function plannedAmounts(planned: number | null, parts: readonly Part[]): Part[] {
  const sorted = [...parts].sort(byRank);
  if (planned === null) {
    return sorted.map((part) => (part.mode === 'FULL' ? { ...part, amount: null } : part));
  }
  const withPercents = sorted.map((part) =>
    part.mode === 'PERCENT' && part.share
      ? { ...part, amount: floorShare(planned, part.share) }
      : part,
  );
  const full = withPercents.find((part) => part.mode === 'FULL');
  if (full) {
    const others = covered(withPercents.filter((part) => part.id !== full.id));
    return withPercents.map((part) =>
      part.id === full.id ? { ...part, amount: planned - others } : part,
    );
  }
  const fixed = sum(
    withPercents.filter((part) => part.mode === 'FIXED').map((part) => part.amount ?? 0),
  );
  const percents = withPercents.filter((part) => part.mode === 'PERCENT');
  const shares = percents
    .map((part) => part.share)
    .filter((share): share is Fraction => share !== null);
  if (!fractionsCoverExactly(planned, planned - fixed, shares)) return withPercents;
  let leftover = planned - covered(withPercents);
  const bonus = new Map<string, number>();
  for (const part of percents) {
    if (leftover <= 0) break;
    bonus.set(part.id, 1);
    leftover -= 1;
  }
  return withPercents.map((part) => ({
    ...part,
    amount: (part.amount ?? 0) + (bonus.get(part.id) ?? 0),
  }));
}

export type SetRefusal =
  | { readonly reason: 'EXCEEDS'; readonly remaining: number }
  | { readonly reason: 'FULL_TAKEN' }
  | { readonly reason: 'PERCENT_WITHOUT_PRICE' };

/**
 * CPT-03, CPT-54, CPT-55 : ajoute, modifie (`part.id` déjà présent) ou retire (`part` nul pour
 * `id`) une participation avant l'achat. Le reste rendu en cas de refus est celui qu'aurait le
 * demandeur s'il n'avait pas de part : c'est ce qu'il peut prendre.
 */
export function setParticipation(
  planned: number | null,
  parts: readonly Part[],
  id: string,
  next: Part | null,
): { readonly parts: Part[] } | SetRefusal {
  const others = parts.filter((part) => part.id !== id);
  if (next === null) return { parts: plannedAmounts(planned, others) };
  if (next.mode === 'PERCENT' && planned === null) return { reason: 'PERCENT_WITHOUT_PRICE' };
  if (next.mode === 'FULL' && others.some((part) => part.mode === 'FULL'))
    return { reason: 'FULL_TAKEN' };
  const result = plannedAmounts(planned, [...others, next]);
  if (planned === null) return { parts: result };
  const remaining = remainingFor(planned, others);
  const full = result.find((part) => part.mode === 'FULL');
  // CPT-54 : la part Tout n'est acceptée que s'il reste quelque chose à couvrir.
  if (full && (full.amount ?? 0) <= 0) return { reason: 'EXCEEDS', remaining };
  // CPT-54 : une part Tout d'un autre ne rétrécit jamais par le geste d'autrui ; elle ne grandit
  // que par un retrait. Quand elle existe, il ne reste rien.
  if (full && full.id !== id) {
    const before = plannedAmounts(planned, parts).find((part) => part.id === full.id);
    if ((full.amount ?? 0) < (before?.amount ?? 0)) return { reason: 'EXCEEDS', remaining: 0 };
  }
  if (covered(result) > planned) return { reason: 'EXCEEDS', remaining };
  if (result.some((part) => (part.amount ?? 0) < 0)) return { reason: 'EXCEEDS', remaining };
  return { parts: result };
}

/** Reste à couvrir laissé par `parts` (une part Tout prend tout). */
export function remainingFor(planned: number, parts: readonly Part[]): number {
  if (parts.some((part) => part.mode === 'FULL')) return 0;
  return Math.max(0, planned - covered(plannedAmounts(planned, parts)));
}

/** Reste à couvrir d'un état dont les montants sont connus ; `null` sans prix. */
export function remaining(total: number | null, parts: readonly Part[]): number | null {
  if (total === null) return null;
  return Math.max(0, total - covered(parts));
}

/**
 * CPT-17 : retire `amount` aux derniers arrivés parmi `eligible`, sans descendre sous zéro.
 * Rend les montants et ce qui n'a pas pu être retiré.
 */
function takeFromLast(parts: Part[], eligible: (part: Part) => boolean, amount: number): number {
  let left = amount;
  const order = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => eligible(part))
    .sort((a, b) => b.part.rank - a.part.rank);
  for (const { part, index } of order) {
    if (left <= 0) break;
    const take = Math.min(part.amount ?? 0, left);
    left -= take;
    parts[index] = { ...part, amount: (part.amount ?? 0) - take };
  }
  return left;
}

/** Une part en pourcentage réduite devient un montant fixe (CPT-57). */
function asFixedIfChanged(before: Part, after: Part): Part {
  if (before.mode === 'PERCENT' && after.amount !== before.amount) {
    return { ...after, mode: 'FIXED', share: null };
  }
  return after;
}

/**
 * CPT-57 : nouveau coût avant l'achat. Les pourcentages restent des pourcentages et la part
 * Tout complète ; sans part relative, une hausse va au dernier arrivé si l'élément était
 * couvert, sinon le reste grandit ; un excédent est retiré aux derniers arrivés.
 */
export function applyPlannedCost(
  oldPlanned: number | null,
  newPlanned: number,
  parts: readonly Part[],
): Part[] {
  const sorted = [...parts].sort(byRank);
  if (!sorted.some(isRelative) && oldPlanned !== null && sorted.length > 0) {
    const wasCovered = covered(sorted) === oldPlanned;
    const gap = newPlanned - oldPlanned;
    const last = sorted.at(-1);
    if (gap > 0 && wasCovered && last) {
      return sorted.map((part) =>
        part.id === last.id ? { ...part, amount: (part.amount ?? 0) + gap } : part,
      );
    }
  }
  const computed = plannedAmounts(newPlanned, sorted).map((part) =>
    part.mode === 'FULL' && (part.amount ?? 0) < 0 ? { ...part, amount: 0 } : part,
  );
  const excess = covered(computed) - newPlanned;
  if (excess <= 0) return computed;
  const reduced = [...computed];
  // Les parts relatives d'abord (CPT-16 : les montants fixes ne bougent qu'en dernier recours).
  const left = takeFromLast(reduced, isRelative, excess);
  takeFromLast(reduced, (part) => part.mode === 'FIXED', left);
  return reduced.map((part, index) => {
    const before = computed[index];
    return before ? asFixedIfChanged(before, part) : part;
  });
}

/**
 * CPT-55 : à l'achat d'un élément sans prix, la part Tout vaut le prix payé moins les montants
 * fixes ; si ceux-ci le dépassent, la baisse se reporte sur les derniers arrivés (CPT-17).
 */
export function resolveUnknownFull(actual: number, parts: readonly Part[]): Part[] {
  const sorted = [...parts].sort(byRank);
  const fixed = covered(sorted.filter((part) => part.mode !== 'FULL'));
  const result = sorted.map((part) =>
    part.mode === 'FULL' ? { ...part, amount: Math.max(0, actual - fixed) } : part,
  );
  const excess = covered(result) - actual;
  if (excess > 0) takeFromLast(result, (part) => part.mode === 'FIXED', excess);
  return result;
}

/**
 * CPT-16, CPT-17 : écart à l'achat, sur des montants figés. Avec au moins une part relative,
 * l'écart est réparti entre elles seules au prorata de leur montant (plancher, centimes par
 * rang) ; une baisse plus grande qu'elles se reporte ensuite sur les montants fixes, des derniers
 * arrivés aux premiers. Sans part relative, tout l'écart va au dernier arrivé (CPT-17).
 */
export function applyGap(planned: number, actual: number, parts: readonly Part[]): Part[] {
  const sorted = [...parts].sort(byRank);
  const gap = actual - planned;
  if (gap === 0 || sorted.length === 0) return sorted;
  const relatives = sorted.filter(isRelative);
  if (relatives.length === 0) {
    const last = sorted.at(-1);
    if (gap > 0 && last) {
      return sorted.map((part) =>
        part.id === last.id ? { ...part, amount: (part.amount ?? 0) + gap } : part,
      );
    }
    const result = [...sorted];
    takeFromLast(result, () => true, -gap);
    return result;
  }
  const base = covered(relatives);
  const size = Math.abs(gap);
  const applied = gap < 0 ? Math.min(size, base) : size;
  const shares = new Map<string, number>();
  let given = 0;
  for (const part of relatives) {
    const weight = base === 0 ? 1 : (part.amount ?? 0);
    const total = base === 0 ? relatives.length : base;
    const share = Number((BigInt(applied) * BigInt(weight)) / BigInt(total));
    shares.set(part.id, share);
    given += share;
  }
  // Centimes restants, un par un, dans l'ordre d'arrivée (CPT-07), sans passer sous zéro.
  let leftover = applied - given;
  while (leftover > 0) {
    let moved = false;
    for (const part of relatives) {
      if (leftover <= 0) break;
      const current = shares.get(part.id) ?? 0;
      if (gap < 0 && current >= (part.amount ?? 0)) continue;
      shares.set(part.id, current + 1);
      leftover -= 1;
      moved = true;
    }
    if (!moved) break;
  }
  const sign = gap < 0 ? -1 : 1;
  const result = sorted.map((part) =>
    shares.has(part.id)
      ? { ...part, amount: (part.amount ?? 0) + sign * (shares.get(part.id) ?? 0) }
      : part,
  );
  if (gap < 0 && size > applied)
    takeFromLast(result, (part) => part.mode === 'FIXED', size - applied);
  return result;
}

export type LowerRefusal = 'NOT_RAISED' | 'WINDOW_CLOSED' | 'OUT_OF_RANGE';

/**
 * CPT-18 : pendant la fenêtre, une part augmentée peut redescendre à un montant au moins égal à
 * celui d'avant l'achat ; la différence devient un reste à couvrir.
 */
export function lowerRaise(input: {
  readonly amount: number;
  readonly prePurchase: number | null;
  readonly target: number;
  readonly now: Date;
  readonly raiseUntil: Date;
}): { readonly amount: number; readonly shortfall: number } | LowerRefusal {
  if (input.prePurchase === null || input.amount <= input.prePurchase) return 'NOT_RAISED';
  if (input.now.getTime() > input.raiseUntil.getTime()) return 'WINDOW_CLOSED';
  if (input.target < input.prePurchase || input.target >= input.amount) return 'OUT_OF_RANGE';
  return { amount: input.target, shortfall: input.amount - input.target };
}
