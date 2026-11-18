/** STA-01 : aucun agrégat sur moins de 10 comptes. */
export const STATS_MIN_ACCOUNTS = 10;
export const STATS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Valeurs brutes lues en base, avant le seuil. */
export interface RawStats {
  readonly accountsTotal: number;
  readonly activeAccounts30d: number;
  readonly accountsCreated30d: number;
  readonly listsCreated30d: number;
  readonly catalogProducts: number;
  /** Délai médian de traitement d'un signalement, en heures, sur 30 jours ; `null` sans données. */
  readonly medianReportHours: number | null;
  readonly extractionsDone30d: number;
  readonly extractionsFailed30d: number;
}

/**
 * STA-02 : agrégats seulement, `null` au-dessous du seuil. Le coût de l'extraction, le taux
 * d'erreur et les temps de réponse sont dans les tableaux de bord d'OpenObserve (OBS-05), pas ici.
 */
export interface PlatformStatsView {
  readonly activeAccounts30d: number | null;
  readonly accountsCreated30d: number | null;
  readonly listsCreated30d: number | null;
  readonly catalogProducts: number | null;
  readonly medianReportHours: number | null;
  readonly extractionSuccessRate: number | null;
}

/**
 * STA-01 : sous 10 comptes, plus rien n'est rendu (un petit groupe se reconnaîtrait) ; un agrégat
 * qui porte lui-même sur moins de 10 comptes est `null`.
 */
export function thresholdStats(raw: RawStats): PlatformStatsView {
  const enough = raw.accountsTotal >= STATS_MIN_ACCOUNTS;
  const gate = (value: number | null, population: number): number | null =>
    enough && population >= STATS_MIN_ACCOUNTS ? value : null;
  const extractions = raw.extractionsDone30d + raw.extractionsFailed30d;
  return {
    activeAccounts30d: gate(raw.activeAccounts30d, raw.activeAccounts30d),
    accountsCreated30d: gate(raw.accountsCreated30d, raw.accountsCreated30d),
    listsCreated30d: gate(raw.listsCreated30d, raw.accountsTotal),
    catalogProducts: gate(raw.catalogProducts, raw.accountsTotal),
    medianReportHours: gate(raw.medianReportHours, raw.accountsTotal),
    extractionSuccessRate: gate(
      extractions === 0 ? null : Math.round((raw.extractionsDone30d / extractions) * 1000) / 1000,
      raw.accountsTotal,
    ),
  };
}

export abstract class PlatformStatsReader {
  abstract read(now: Date): Promise<RawStats>;
}
