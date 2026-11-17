import fc from 'fast-check';
import type { Fraction } from './money';
import {
  applyGap,
  applyPlannedCost,
  covered,
  lowerRaise,
  plannedAmounts,
  remainingFor,
  resolveUnknownFull,
  setParticipation,
  type Part,
} from './shares';

const fixed = (id: string, rank: number, amount: number): Part => ({
  id,
  rank,
  mode: 'FIXED',
  share: null,
  amount,
});
const percent = (id: string, rank: number, num: number, den: number): Part => ({
  id,
  rank,
  mode: 'PERCENT',
  share: { num, den },
  amount: null,
});
const full = (id: string, rank: number): Part => ({
  id,
  rank,
  mode: 'FULL',
  share: null,
  amount: null,
});
const amounts = (parts: readonly Part[]) =>
  Object.fromEntries(parts.map((part) => [part.id, part.amount]));

describe('Critères d’acceptation de 07', () => {
  it('CPT-07 : trois fois 33 % sur 100,00 € → 33,00 € chacun, 1,00 € de reste', () => {
    const parts = plannedAmounts(10_000, [
      percent('a', 1, 33, 100),
      percent('b', 2, 33, 100),
      percent('c', 3, 33, 100),
    ]);
    expect(amounts(parts)).toEqual({ a: 3_300, b: 3_300, c: 3_300 });
    expect(remainingFor(10_000, parts)).toBe(100);
  });

  it('CPT-07, CPT-53 : trois tiers → 33,34 € + 33,33 € + 33,33 €, le centime au premier arrivé', () => {
    const parts = plannedAmounts(10_000, [
      percent('c', 3, 1, 3),
      percent('a', 1, 1, 3),
      percent('b', 2, 1, 3),
    ]);
    expect(amounts(parts)).toEqual({ a: 3_334, b: 3_333, c: 3_333 });
    expect(covered(parts)).toBe(10_000);
  });

  it('CPT-16 : 100 € prévus, 110 € payés ; A 60 %, B fixe 40 € → A 70 €, B 40 €', () => {
    const before = plannedAmounts(10_000, [percent('a', 1, 60, 100), fixed('b', 2, 4_000)]);
    expect(amounts(applyGap(10_000, 11_000, before))).toEqual({ a: 7_000, b: 4_000 });
  });

  it('CPT-17, CPT-18 : A fixe 30 € puis B fixe 70 € → B 80 € ; ramené à 72 €, il reste 8 €', () => {
    const after = applyGap(10_000, 11_000, [fixed('a', 1, 3_000), fixed('b', 2, 7_000)]);
    expect(amounts(after)).toEqual({ a: 3_000, b: 8_000 });
    const lowered = lowerRaise({
      amount: 8_000,
      prePurchase: 7_000,
      target: 7_200,
      now: new Date('2026-12-01'),
      raiseUntil: new Date('2026-12-08'),
    });
    expect(lowered).toEqual({ amount: 7_200, shortfall: 800 });
  });
});

describe('CPT-17 : baisse sur montants fixes, du dernier au premier', () => {
  it('une baisse plus grande que la dernière part passe à l’avant-dernière', () => {
    const after = applyGap(10_000, 7_000, [
      fixed('a', 1, 5_000),
      fixed('b', 2, 3_000),
      fixed('c', 3, 2_000),
    ]);
    expect(amounts(after)).toEqual({ a: 5_000, b: 2_000, c: 0 });
  });

  it('CPT-16 : une baisse plus grande que les parts relatives touche ensuite les montants fixes', () => {
    const frozen = plannedAmounts(10_000, [percent('a', 1, 20, 100), fixed('b', 2, 8_000)]);
    expect(amounts(applyGap(10_000, 3_000, frozen))).toEqual({ a: 0, b: 3_000 });
  });
});

describe('CPT-18 : refus d’une hausse', () => {
  const base = {
    amount: 8_000,
    prePurchase: 7_000,
    now: new Date('2026-12-01'),
    raiseUntil: new Date('2026-12-08'),
  };
  it('pas sous le montant d’avant l’achat, pas après la fenêtre, pas sans hausse', () => {
    expect(lowerRaise({ ...base, target: 6_999 })).toBe('OUT_OF_RANGE');
    expect(lowerRaise({ ...base, target: 8_000 })).toBe('OUT_OF_RANGE');
    expect(lowerRaise({ ...base, target: 7_500, now: new Date('2026-12-09') })).toBe(
      'WINDOW_CLOSED',
    );
    expect(lowerRaise({ ...base, amount: 7_000, target: 7_000 })).toBe('NOT_RAISED');
    expect(lowerRaise({ ...base, prePurchase: null, target: 7_000 })).toBe('NOT_RAISED');
  });
});

describe('CPT-03, CPT-54, CPT-55 : participer', () => {
  it('CPT-03 : dépasser le coût est refusé avec le reste que le demandeur peut prendre', () => {
    const parts = plannedAmounts(10_000, [fixed('a', 1, 7_700)]);
    expect(setParticipation(10_000, parts, 'b', fixed('b', 2, 3_000))).toEqual({
      reason: 'EXCEEDS',
      remaining: 2_300,
    });
    const ok = setParticipation(10_000, parts, 'b', fixed('b', 2, 2_300));
    expect('parts' in ok && covered(ok.parts)).toBe(10_000);
  });

  it('CPT-54 : Tout complète, une seule par élément, refusée s’il ne reste rien', () => {
    const parts = plannedAmounts(10_000, [fixed('a', 1, 7_700)]);
    const ok = setParticipation(10_000, parts, 'b', full('b', 2));
    expect('parts' in ok && amounts(ok.parts)).toEqual({ a: 7_700, b: 2_300 });
    if (!('parts' in ok)) throw new Error('attendu');
    expect(setParticipation(10_000, ok.parts, 'c', full('c', 3))).toEqual({
      reason: 'FULL_TAKEN',
    });
    expect(setParticipation(10_000, ok.parts, 'c', fixed('c', 3, 1))).toEqual({
      reason: 'EXCEEDS',
      remaining: 0,
    });
    const covered100 = plannedAmounts(10_000, [fixed('a', 1, 10_000)]);
    expect(setParticipation(10_000, covered100, 'b', full('b', 2))).toEqual({
      reason: 'EXCEEDS',
      remaining: 0,
    });
  });

  it('CPT-54 : la part Tout grandit quand une autre se retire', () => {
    const parts = plannedAmounts(10_000, [fixed('a', 1, 3_000), full('b', 2)]);
    const after = setParticipation(10_000, parts, 'a', null);
    expect('parts' in after && amounts(after.parts)).toEqual({ b: 10_000 });
  });

  it('CPT-55 : sans prix, Tout de montant inconnu, montants fixes, pas de pourcentage', () => {
    const ok = setParticipation(null, [fixed('a', 1, 2_000)], 'b', full('b', 2));
    expect('parts' in ok && amounts(ok.parts)).toEqual({ a: 2_000, b: null });
    expect(setParticipation(null, [], 'c', percent('c', 1, 1, 2))).toEqual({
      reason: 'PERCENT_WITHOUT_PRICE',
    });
    expect(amounts(resolveUnknownFull(5_000, [fixed('a', 1, 2_000), full('b', 2)]))).toEqual({
      a: 2_000,
      b: 3_000,
    });
    // Montants fixes au-delà du prix payé : la baisse va au dernier arrivé (CPT-17).
    expect(
      amounts(
        resolveUnknownFull(2_500, [fixed('a', 1, 2_000), fixed('c', 3, 1_000), full('b', 2)]),
      ),
    ).toEqual({ a: 2_000, b: 0, c: 500 });
  });
});

describe('CPT-57 : nouveau coût avant l’achat', () => {
  it('un pourcentage reste un pourcentage et Tout complète', () => {
    const parts = plannedAmounts(10_000, [percent('a', 1, 60, 100), full('b', 2)]);
    expect(amounts(applyPlannedCost(10_000, 11_000, parts))).toEqual({ a: 6_600, b: 4_400 });
  });

  it('sans part relative : hausse au dernier arrivé si couvert, sinon le reste grandit', () => {
    const coveredParts = [fixed('a', 1, 3_000), fixed('b', 2, 7_000)];
    expect(amounts(applyPlannedCost(10_000, 11_000, coveredParts))).toEqual({
      a: 3_000,
      b: 8_000,
    });
    const open = [fixed('a', 1, 3_000), fixed('b', 2, 5_000)];
    expect(amounts(applyPlannedCost(10_000, 11_000, open))).toEqual({ a: 3_000, b: 5_000 });
  });

  it('un excédent est retiré aux derniers arrivés ; un pourcentage réduit devient fixe', () => {
    const parts = plannedAmounts(10_000, [fixed('a', 1, 5_000), percent('b', 2, 50, 100)]);
    const after = applyPlannedCost(10_000, 6_000, parts);
    expect(amounts(after)).toEqual({ a: 5_000, b: 1_000 });
    expect(after.find((part) => part.id === 'b')).toMatchObject({ mode: 'FIXED', share: null });
  });
});

// ---------------------------------------------------------------------------
// Propriétés (ADR 0019) : aucune part négative, la somme ne dépasse jamais le total, et elle
// l'égale quand l'élément est couvert ; le résultat ne dépend pas de l'ordre de lecture.
// ---------------------------------------------------------------------------

const total = fc.integer({ min: 0, max: 10_000_000 });
const fraction: fc.Arbitrary<Fraction> = fc.oneof(
  fc.integer({ min: 1, max: 10_000 }).map((num) => ({ num, den: 10_000 })),
  fc
    .integer({ min: 2, max: 10 })
    .chain((den) => fc.integer({ min: 1, max: den }).map((num) => ({ num, den }))),
);

/** Participations triées par rang, ids uniques ; au plus une Tout. */
const partsArb = (maxAmount: number) =>
  fc
    .array(
      fc.oneof(
        fc
          .integer({ min: 0, max: maxAmount })
          .map((amount) => ({ mode: 'FIXED' as const, amount })),
        fraction.map((share) => ({ mode: 'PERCENT' as const, share })),
        fc.constant({ mode: 'FULL' as const }),
      ),
      { maxLength: 8 },
    )
    .map((raw) => {
      let fullSeen = false;
      return raw
        .filter((part) => {
          if (part.mode !== 'FULL') return true;
          if (fullSeen) return false;
          fullSeen = true;
          return true;
        })
        .map((part, index): Part => ({
          id: `p${index}`,
          rank: index + 1,
          mode: part.mode,
          share: part.mode === 'PERCENT' ? part.share : null,
          amount: part.mode === 'FIXED' ? part.amount : null,
        }));
    });

const nonNegative = (parts: readonly Part[]) => parts.every((part) => (part.amount ?? 0) >= 0);

describe('Propriétés des parts', () => {
  it('setParticipation accepté : parts positives, somme ≤ coût, = coût avec une part Tout', () => {
    fc.assert(
      fc.property(total, partsArb(2_000_000), (planned, parts) => {
        let state: Part[] = [];
        for (const part of parts) {
          const result = setParticipation(planned, state, part.id, part);
          if (!('parts' in result)) continue;
          state = result.parts;
          expect(nonNegative(state)).toBe(true);
          expect(covered(state)).toBeLessThanOrEqual(planned);
          if (state.some((p) => p.mode === 'FULL')) expect(covered(state)).toBe(planned);
        }
      }),
    );
  });

  it('CPT-07 : des fractions qui couvrent tout donnent exactement le coût', () => {
    fc.assert(
      fc.property(total, fc.integer({ min: 1, max: 10 }), (planned, count) => {
        const parts = Array.from({ length: count }, (_, index) =>
          percent(`p${index}`, index + 1, 1, count),
        );
        const result = plannedAmounts(planned, parts);
        expect(covered(result)).toBe(planned);
        const values = result.map((part) => part.amount ?? 0);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('l’ordre de lecture ne change rien', () => {
    fc.assert(
      fc.property(total, partsArb(2_000_000), fc.integer(), (planned, parts, seed) => {
        const shuffled = [...parts].sort(
          (a, b) => ((a.rank * 7919 + seed) % 13) - ((b.rank * 7919 + seed) % 13),
        );
        expect(amounts(plannedAmounts(planned, shuffled))).toEqual(
          amounts(plannedAmounts(planned, parts)),
        );
      }),
    );
  });

  it('CPT-16, CPT-17 : l’écart s’ajoute exactement, sans part négative', () => {
    fc.assert(
      fc.property(
        total,
        partsArb(1_000_000),
        fc.integer({ min: -2_000_000, max: 2_000_000 }),
        (planned, parts, gap) => {
          const frozen = plannedAmounts(planned, parts).map((part) => ({
            ...part,
            amount: Math.max(0, part.amount ?? 0),
          }));
          const before = covered(frozen);
          const actual = Math.max(0, planned + gap);
          const after = applyGap(planned, actual, frozen);
          expect(nonNegative(after)).toBe(true);
          const expected = frozen.length === 0 ? 0 : Math.max(0, before + (actual - planned));
          expect(covered(after)).toBe(expected);
          if (frozen.some((p) => p.mode !== 'FIXED') && actual >= planned) {
            for (const part of frozen.filter((p) => p.mode === 'FIXED')) {
              expect(after.find((p) => p.id === part.id)?.amount).toBe(part.amount);
            }
          }
        },
      ),
    );
  });

  it('CPT-57 : un nouveau coût ne laisse jamais de part négative ni de dépassement', () => {
    fc.assert(
      fc.property(total, total, partsArb(2_000_000), (oldPlanned, newPlanned, parts) => {
        let state: Part[] = [];
        for (const part of parts) {
          const result = setParticipation(oldPlanned, state, part.id, part);
          if ('parts' in result) state = result.parts;
        }
        const after = applyPlannedCost(oldPlanned, newPlanned, state);
        expect(nonNegative(after)).toBe(true);
        expect(covered(after)).toBeLessThanOrEqual(Math.max(newPlanned, covered(state)));
        expect(covered(after)).toBeLessThanOrEqual(
          newPlanned + (state.every((p) => p.mode === 'FIXED') ? covered(state) : 0),
        );
      }),
    );
  });

  it('CPT-55 : le prix payé est exactement couvert dès qu’il y a une part Tout', () => {
    fc.assert(
      fc.property(total, partsArb(2_000_000), (actual, parts) => {
        const known = parts.filter((part) => part.mode !== 'PERCENT');
        if (!known.some((part) => part.mode === 'FULL')) return;
        const after = resolveUnknownFull(actual, known);
        expect(nonNegative(after)).toBe(true);
        expect(covered(after)).toBe(actual);
      }),
    );
  });
});
