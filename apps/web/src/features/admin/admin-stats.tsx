'use client';

import { useGetPlatformStats } from '@wishlist/api-client';
import { useTranslations } from 'next-intl';

/** STA-01, STA-02 : nombres seulement ; `null` (moins de 10 comptes) est dit, jamais montré à 0. */
export function AdminStats() {
  const t = useTranslations('admin.stats');
  const stats = useGetPlatformStats();
  const data = stats.data;
  if (!data) return null;

  const rows: { key: string; value: number | null; format?: (v: number) => string }[] = [
    { key: 'active', value: data.activeAccounts30d },
    { key: 'created', value: data.accountsCreated30d },
    { key: 'lists', value: data.listsCreated30d },
    { key: 'catalog', value: data.catalogProducts },
    { key: 'reports', value: data.openReports },
    {
      key: 'median',
      value: data.medianReportHours,
      format: (v) => t('hours', { value: v.toFixed(1) }),
    },
    {
      key: 'extraction',
      value: data.extractionSuccessRate,
      format: (v) => t('percent', { value: Math.round(v * 100) }),
    },
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.key} className="rounded-lg border border-border bg-surface p-4">
          <dt className="text-sm text-foreground-muted">{t(row.key)}</dt>
          <dd className="text-2xl font-semibold">
            {row.value === null ? (
              <>
                <span aria-hidden="true">—</span>
                <span className="sr-only">{t('masked')}</span>
                <span
                  className="block text-sm font-normal text-foreground-muted"
                  aria-hidden="true"
                >
                  {t('masked')}
                </span>
              </>
            ) : row.format ? (
              row.format(row.value)
            ) : (
              row.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
