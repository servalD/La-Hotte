/** EVT-05 : un jour sans heure, affiché tel quel (jamais converti de fuseau). */
export function formatDay(day: string, locale: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
