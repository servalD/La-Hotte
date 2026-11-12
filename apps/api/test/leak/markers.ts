import { randomBytes, randomInt } from 'node:crypto';

/**
 * Marqueurs du test de non-fuite (OBS-26), tirés à chaque exécution. Le `_` rend la chaîne
 * invalide comme `x-request-id` (`[A-Za-z0-9-]`) : elle ne peut pas être reprise légitimement
 * comme identifiant de requête. Lettres, chiffres et `_` : sa forme encodée pour une URL est
 * identique. Le montant est un entier à 9 chiffres, comme une somme en unités mineures.
 */
export const MARKER = `MARQUEUR_${randomBytes(6).toString('hex')}`;
export const AMOUNT_MARKER = randomInt(100_000_000, 999_999_999);

/** Champs qu'un événement d'erreur peut garder (`scrubErrorEvent`, OBS-28) : liste blanche. */
export const ALLOWED_EVENT_KEYS: ReadonlySet<string> = new Set([
  'event_id',
  'timestamp',
  'platform',
  'level',
  'environment',
  'release',
  'sdk',
  'fingerprint',
  'debug_meta',
  'exception',
  'tags',
  'contexts',
]);

/** Événements d'une enveloppe Sentry : charge des éléments dont l'en-tête est `event`. */
export function envelopeEvents(body: string): Record<string, unknown>[] {
  const lines = body.split('\n');
  const events: Record<string, unknown>[] = [];
  // Ligne 0 : en-tête d'enveloppe ; puis paires en-tête d'élément, charge.
  for (let i = 1; i + 1 < lines.length; i += 2) {
    const header = JSON.parse(lines[i] || '{}') as { type?: unknown };
    if (header.type === 'event') events.push(JSON.parse(lines[i + 1] || '{}'));
  }
  return events;
}

/**
 * Le montant n'est cherché qu'isolé (ni précédé ni suivi d'un chiffre) : un horodatage en
 * nanosecondes peut le contenir par hasard.
 */
function patterns(marker: string, amount: number): RegExp[] {
  return [new RegExp(marker), new RegExp(`(?<!\\d)${amount}(?!\\d)`)];
}

/** Première occurrence d'un marqueur, avec son contexte pour un message d'échec lisible. */
export function findMarker(
  text: string,
  marker = MARKER,
  amount = AMOUNT_MARKER,
): string | undefined {
  for (const pattern of patterns(marker, amount)) {
    const match = pattern.exec(text);
    if (match) return text.slice(Math.max(0, match.index - 200), match.index + 80);
  }
  return undefined;
}
