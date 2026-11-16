// EVT-05 (ADR 0017) : la date d'un événement est un jour sans heure (`AAAA-MM-JJ`), lu dans le
// fuseau de l'événement. Fonctions pures : l'heure vient du port `Clock`.

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Vrai si `timezone` est un fuseau IANA connu du moteur. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Vrai pour un jour calendaire existant (`2027-02-29` est refusé). */
export function isValidDay(day: string): boolean {
  const match = DAY_PATTERN.exec(day);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Jour local de `instant` dans `timezone`. */
export function localDay(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Décale un jour de `days` jours. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** EVT-40 : un an plus tard ; le 29 février devient le 28. */
export function addOneYear(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const next = `${String(y + 1).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidDay(next) ? next : next.replace(/-02-29$/, '-02-28');
}

/** EVT-05 : la date est-elle passée (le jour local de maintenant est après elle) ? */
export function isDayPassed(day: string, timezone: string, now: Date): boolean {
  return localDay(now, timezone) > day;
}

/** EVT-05 : la date est-elle aujourd'hui ou plus tard, dans le fuseau ? */
export function isDayTodayOrLater(day: string, timezone: string, now: Date): boolean {
  return day >= localDay(now, timezone);
}

/** EVT-33 : 30 jours après la date. */
export function isDoneDue(day: string, timezone: string, now: Date): boolean {
  return localDay(now, timezone) > addDays(day, 30);
}

/** Décalage de `timezone` à `instant`, en millisecondes (heure locale − UTC). */
function offsetAt(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** EVT-16 : fin du jour dans le fuseau, soit minuit du lendemain, heure locale. */
export function endOfDay(day: string, timezone: string): Date {
  const [y, m, d] = addDays(day, 1).split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d);
  // Deux passes : le décalage peut changer entre l'estimation et l'instant visé (heure d'été).
  let guess = wall - offsetAt(new Date(wall), timezone);
  guess = wall - offsetAt(new Date(guess), timezone);
  return new Date(guess);
}
