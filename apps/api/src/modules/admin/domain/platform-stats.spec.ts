import { describe, expect, it } from 'vitest';
import { type RawStats, thresholdStats } from './platform-stats';

const raw: RawStats = {
  accountsTotal: 120,
  activeAccounts30d: 40,
  accountsCreated30d: 12,
  listsCreated30d: 30,
  catalogProducts: 7,
  medianReportHours: 5.5,
  extractionsDone30d: 90,
  extractionsFailed30d: 10,
};

describe('Statistiques (STA-01, STA-02)', () => {
  it('agrégats rendus au-dessus du seuil', () => {
    expect(thresholdStats(raw)).toEqual({
      activeAccounts30d: 40,
      accountsCreated30d: 12,
      listsCreated30d: 30,
      catalogProducts: 7,
      medianReportHours: 5.5,
      extractionSuccessRate: 0.9,
    });
  });

  it('moins de 10 comptes au total : plus rien', () => {
    expect(Object.values(thresholdStats({ ...raw, accountsTotal: 9 }))).toEqual(
      Array(6).fill(null),
    );
  });

  it('un groupe de moins de 10 comptes : null, pas zéro', () => {
    const stats = thresholdStats({ ...raw, accountsCreated30d: 3, activeAccounts30d: 9 });
    expect(stats.accountsCreated30d).toBeNull();
    expect(stats.activeAccounts30d).toBeNull();
    expect(stats.listsCreated30d).toBe(30);
  });

  it('aucune extraction : taux inconnu', () => {
    expect(
      thresholdStats({ ...raw, extractionsDone30d: 0, extractionsFailed30d: 0 })
        .extractionSuccessRate,
    ).toBeNull();
  });
});
