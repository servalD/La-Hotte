// OBS-26 : tout ce qu'un objet d'erreur transmis au SDK laisse lire (message, pile, propriétés
// propres, énumérables ou non, et causes), pour y chercher le marqueur. En JavaScript simple : le
// test (TypeScript) et le processus enfant des erreurs fatales (`fixtures/fatal-child.mjs`,
// exécuté par Node sans transformation) partagent ce module.
import { inspect } from 'node:util';

/** @param {unknown} value @returns {string} */
export function describeHandedError(value) {
  const parts = [inspect(value, { depth: 8, showHidden: true })];
  if (value instanceof Error) {
    parts.push(value.message, value.stack ?? '');
    for (const key of Object.getOwnPropertyNames(value)) {
      parts.push(inspect(/** @type {Record<string, unknown>} */ (value)[key], { depth: 8 }));
    }
    if (value.cause !== undefined) parts.push(describeHandedError(value.cause));
  }
  return parts.join('\n');
}
