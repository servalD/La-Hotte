import fc from 'fast-check';
import { brokenChain, replay, type LedgerRecord } from './ledger';
import { offsetMoves, owed, pairBalances, settlementState, type BalanceLine } from './settlement';

const line = (
  contributionId: string,
  participantId: string,
  buyerId: string,
  owedMinor: number,
  day = 1,
  currency = 'EUR',
): BalanceLine => ({
  contributionId,
  participantId,
  buyerId,
  currency,
  owed: owedMinor,
  purchasedAt: new Date(Date.UTC(2026, 11, day)),
});

describe('CPT-20 à CPT-22, CPT-65 : état d’une part', () => {
  const base = { isBuyer: false, purchased: true, amount: 4_000, settled: 0, claimed: false };
  it('à régler, à confirmer, réglée ; jamais rien pour l’acheteur', () => {
    expect(settlementState(base)).toBe('DUE');
    expect(settlementState({ ...base, claimed: true })).toBe('CLAIMED');
    expect(settlementState({ ...base, settled: 4_000 })).toBe('SETTLED');
    expect(settlementState({ ...base, isBuyer: true })).toBe('NONE');
  });

  it('CPT-21 : réglée avant l’achat = avancée ; CPT-65 : une hausse la remet à régler', () => {
    expect(settlementState({ ...base, purchased: false, settled: 4_000 })).toBe('SETTLED');
    expect(settlementState({ ...base, purchased: false })).toBe('NONE');
    expect(settlementState({ ...base, amount: 4_500, settled: 4_000 })).toBe('DUE');
    expect(owed({ purchased: true, amount: 4_500, settled: 4_000 })).toBe(500);
  });

  it('CPT-65 : une avance non suivie d’achat est due en retour', () => {
    expect(owed({ purchased: false, amount: 4_000, settled: 4_000 })).toBe(-4_000);
  });
});

describe('CPT-31, CPT-33, CPT-67 : soldes', () => {
  it('je dois 20 € à Paul, il m’en doit 15 € → je lui dois 5 €', () => {
    const balances = pairBalances('me', [
      line('c1', 'me', 'paul', 2_000),
      line('c2', 'paul', 'me', 1_500),
    ]);
    expect(balances).toEqual([
      expect.objectContaining({
        otherId: 'paul',
        currency: 'EUR',
        iOwe: 2_000,
        owesMe: 1_500,
        net: 500,
      }),
    ]);
  });

  it('CPT-33 : deux devises ne se mélangent jamais ; la part de l’acheteur n’entre pas', () => {
    const balances = pairBalances('me', [
      line('c1', 'me', 'paul', 2_000),
      line('c2', 'paul', 'me', 1_500, 1, 'CHF'),
      line('c3', 'me', 'me', 9_000),
      line('c4', 'paul', 'marie', 700),
    ]);
    expect(balances.map((b) => [b.currency, b.net])).toEqual([
      ['CHF', -1_500],
      ['EUR', 2_000],
    ]);
  });
});

describe('CPT-68 : compensation', () => {
  it('le sens faible est réglé en entier, l’autre à hauteur du même total, par ordre d’achat', () => {
    const moves = offsetMoves('me', 'paul', 'EUR', [
      line('c1', 'me', 'paul', 1_200, 3),
      line('c2', 'me', 'paul', 800, 1),
      line('c3', 'paul', 'me', 1_500, 2),
    ]);
    expect(moves).toEqual([
      { contributionId: 'c2', add: 800 },
      { contributionId: 'c1', add: 700 },
      { contributionId: 'c3', add: 1_500 },
    ]);
  });

  it('rien à compenser dans un seul sens ou dans une autre devise', () => {
    expect(offsetMoves('me', 'paul', 'EUR', [line('c1', 'me', 'paul', 1_200)])).toEqual([]);
    expect(
      offsetMoves('me', 'paul', 'EUR', [
        line('c1', 'me', 'paul', 1_200),
        line('c2', 'paul', 'me', 500, 1, 'CHF'),
      ]),
    ).toEqual([]);
  });

  it('propriété : chaque sens est réglé du même total, sans dépasser aucune part', () => {
    const side = fc.array(fc.integer({ min: 1, max: 1_000_000 }), { maxLength: 6 });
    fc.assert(
      fc.property(side, side, (mine, theirs) => {
        const lines = [
          ...mine.map((owedMinor, i) => line(`m${i}`, 'me', 'paul', owedMinor, i + 1)),
          ...theirs.map((owedMinor, i) => line(`t${i}`, 'paul', 'me', owedMinor, i + 1)),
        ];
        const moves = offsetMoves('me', 'paul', 'EUR', lines);
        const total = (prefix: string) =>
          moves.filter((m) => m.contributionId.startsWith(prefix)).reduce((s, m) => s + m.add, 0);
        const expected = Math.min(
          mine.reduce((s, v) => s + v, 0),
          theirs.reduce((s, v) => s + v, 0),
        );
        expect(total('m')).toBe(expected);
        expect(total('t')).toBe(expected);
        for (const move of moves) {
          const source = lines.find((l) => l.contributionId === move.contributionId)!;
          expect(move.add).toBeGreaterThan(0);
          expect(move.add).toBeLessThanOrEqual(source.owed);
        }
        // Après compensation, le solde net est inchangé.
        const before = pairBalances('me', lines)[0]?.net ?? 0;
        const after =
          pairBalances(
            'me',
            lines.map((l) => ({
              ...l,
              owed: l.owed - (moves.find((m) => m.contributionId === l.contributionId)?.add ?? 0),
            })),
          )[0]?.net ?? 0;
        expect(after).toBe(before);
      }),
    );
  });
});

describe('CPT-50, CPT-70 : journal', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 11, 1, 10, minute));
  const entries: LedgerRecord[] = [
    {
      id: '01',
      kind: 'CONTRIBUTION_SET',
      targetId: 'c1',
      before: null,
      after: { amount: 1_000 },
      at: at(0),
    },
    {
      id: '02',
      kind: 'CONTRIBUTION_SET',
      targetId: 'c1',
      before: { amount: 1_000 },
      after: { amount: 2_000 },
      at: at(5),
    },
    {
      id: '03',
      kind: 'PURCHASE_SET',
      targetId: 'p1',
      before: null,
      after: { actual: 2_000 },
      at: at(5),
    },
    {
      id: '04',
      kind: 'PURCHASE_REMOVED',
      targetId: 'p1',
      before: { actual: 2_000 },
      after: null,
      at: at(9),
    },
  ];

  it('rejouer jusqu’à une date redonne l’état de chaque ligne à cette date', () => {
    expect(Object.fromEntries(replay(entries, at(1)))).toEqual({ c1: { amount: 1_000 } });
    expect(Object.fromEntries(replay(entries, at(5)))).toEqual({
      c1: { amount: 2_000 },
      p1: { actual: 2_000 },
    });
    expect(Object.fromEntries(replay([...entries].reverse()))).toEqual({ c1: { amount: 2_000 } });
  });

  it('une écriture qui ne part pas de l’état précédent est signalée', () => {
    expect(brokenChain(entries)).toEqual([]);
    const forged: LedgerRecord = { ...entries[1]!, id: '05', before: { amount: 9 }, at: at(6) };
    expect(brokenChain([...entries, forged])).toEqual(['05']);
  });
});
