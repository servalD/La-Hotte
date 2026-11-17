/**
 * Règlements, soldes et compensation (CPT-20 à CPT-22, CPT-30 à CPT-33, CPT-65, CPT-67,
 * CPT-68). Fonctions pures sur des entiers en unités mineures.
 */

export type SettlementState = 'NONE' | 'DUE' | 'CLAIMED' | 'SETTLED';

/**
 * CPT-20 à CPT-22, CPT-65 : état d'une part. La part de l'acheteur n'a rien à régler ; avant
 * l'achat, une part réglée est « avancée » ; après, elle est réglée quand le montant réglé
 * atteint sa valeur, sinon à régler, ou à confirmer si le participant l'a signalée payée.
 */
export function settlementState(input: {
  readonly isBuyer: boolean;
  readonly purchased: boolean;
  readonly amount: number;
  readonly settled: number;
  readonly claimed: boolean;
}): SettlementState {
  if (input.isBuyer) return 'NONE';
  if (!input.purchased) return input.settled > 0 ? 'SETTLED' : 'NONE';
  if (input.settled >= input.amount) return 'SETTLED';
  return input.claimed ? 'CLAIMED' : 'DUE';
}

/**
 * CPT-65, CPT-67 : ce que le participant doit encore à l'acheteur, signé. Avant l'achat, rien
 * n'est dû ; une avance est alors due en retour par l'acheteur (négatif) tant que rien n'est
 * acheté. Une part réglée au-delà de sa valeur (baisse après règlement) est un trop-perçu.
 */
export function owed(input: {
  readonly purchased: boolean;
  readonly amount: number;
  readonly settled: number;
}): number {
  return (input.purchased ? input.amount : 0) - input.settled;
}

export interface BalanceLine {
  readonly contributionId: string;
  readonly participantId: string;
  readonly buyerId: string;
  readonly currency: string;
  /** Signé : positif, le participant doit à l'acheteur. */
  readonly owed: number;
  /** Ordre des achats (CPT-68) ; absent avant l'achat. */
  readonly purchasedAt: Date | null;
}

export interface PairBalance {
  readonly otherId: string;
  readonly currency: string;
  /** Ce que je dois à l'autre. */
  readonly iOwe: number;
  /** Ce que l'autre me doit. */
  readonly owesMe: number;
  /** Positif : je dois ; négatif : on me doit (CPT-31). */
  readonly net: number;
  readonly lines: readonly BalanceLine[];
}

/**
 * CPT-30, CPT-33, CPT-67 : soldes du profil `me` avec chaque autre profil, devise par devise.
 * Une ligne compte quand l'un est participant et l'autre acheteur ; la part de l'acheteur
 * lui-même n'entre jamais.
 */
export function pairBalances(me: string, lines: readonly BalanceLine[]): PairBalance[] {
  const groups = new Map<string, { otherId: string; currency: string; lines: BalanceLine[] }>();
  for (const line of lines) {
    if (line.participantId === line.buyerId || line.owed === 0) continue;
    const otherId =
      line.participantId === me ? line.buyerId : line.buyerId === me ? line.participantId : null;
    if (otherId === null) continue;
    const key = `${otherId}:${line.currency}`;
    const group = groups.get(key) ?? { otherId, currency: line.currency, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      let iOwe = 0;
      let owesMe = 0;
      for (const line of group.lines) {
        // Je suis participant et je dois (ou l'acheteur me doit un trop-perçu, et inversement).
        const mine = line.participantId === me ? line.owed : -line.owed;
        if (mine > 0) iOwe += mine;
        else owesMe += -mine;
      }
      return { ...group, iOwe, owesMe, net: iOwe - owesMe };
    })
    .sort((a, b) => a.otherId.localeCompare(b.otherId) || a.currency.localeCompare(b.currency));
}

export interface OffsetMove {
  readonly contributionId: string;
  /** Montant réglé ajouté à la part. */
  readonly add: number;
}

/**
 * CPT-68 : compensation entre `a` et `b` dans une devise. Les montants dus du sens le plus
 * faible sont réglés en entier, ceux de l'autre sens à hauteur du même total, part par part
 * dans l'ordre des achats. Seules les parts positives (dues après l'achat) y entrent.
 */
export function offsetMoves(
  a: string,
  b: string,
  currency: string,
  lines: readonly BalanceLine[],
): OffsetMove[] {
  const due = (from: string, to: string) =>
    lines
      .filter(
        (line) =>
          line.currency === currency &&
          line.participantId === from &&
          line.buyerId === to &&
          line.owed > 0 &&
          line.purchasedAt !== null,
      )
      .sort(
        (x, y) =>
          (x.purchasedAt?.getTime() ?? 0) - (y.purchasedAt?.getTime() ?? 0) ||
          x.contributionId.localeCompare(y.contributionId),
      );
  const ab = due(a, b);
  const ba = due(b, a);
  const total = (side: readonly BalanceLine[]) => side.reduce((sum, line) => sum + line.owed, 0);
  const amount = Math.min(total(ab), total(ba));
  if (amount === 0) return [];
  const settle = (side: readonly BalanceLine[]): OffsetMove[] => {
    let left = amount;
    const moves: OffsetMove[] = [];
    for (const line of side) {
      if (left <= 0) break;
      const add = Math.min(line.owed, left);
      left -= add;
      moves.push({ contributionId: line.contributionId, add });
    }
    return moves;
  };
  return [...settle(ab), ...settle(ba)];
}
