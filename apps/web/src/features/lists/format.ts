/**
 * ART-11 : affichage d'un montant en unités mineures, sans passer par un flottant : la chaîne
 * décimale est construite à partir de l'entier, puis formatée par `Intl` (qui accepte une chaîne).
 */
export function formatMinor(minor: number, currency: string, locale: string): string {
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    return `${minor} ${currency}`;
  }
  const sign = minor < 0 ? '-' : '';
  const raw = String(Math.abs(minor)).padStart(digits + 1, '0');
  const decimal = digits > 0 ? `${raw.slice(0, -digits)}.${raw.slice(-digits)}` : raw;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    `${sign}${decimal}` as unknown as number,
  );
}

/** Saisie « 19,99 » → unités mineures entières ; `null` si illisible (le serveur revalide). */
export function parseMinor(input: string, currency: string, locale: string): number | null {
  const clean = input.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(clean)) return null;
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    return null;
  }
  const [whole = '0', fraction = ''] = clean.split('.');
  if (fraction.length > digits) return null;
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
}

/** EXT-47 : image servie par notre API, jamais par le site marchand (EXT-03). */
export function imageUrl(key: string): string {
  return `/api/v1/images/${key}`;
}
