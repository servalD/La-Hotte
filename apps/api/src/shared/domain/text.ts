/**
 * MOD-09 : forme de comparaison d'un terme, sans accent ni casse, espaces réduits. Partagée par
 * le module `admin` (réglages) et le module `catalog` (contrôle à la publication).
 */
export function normalizeTerm(raw: string): string {
  return raw.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
