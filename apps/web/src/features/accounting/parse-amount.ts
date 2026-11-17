/** Montant saisi en unités (« 23,50 ») → unités mineures entières (invariant 4). */
export function parseAmount(text: string): number | null {
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [units = '0', cents = ''] = normalized.split('.');
  return Number(units) * 100 + Number(cents.padEnd(2, '0'));
}
