import { createHash } from 'node:crypto';

/**
 * PIN-05 : empreinte du hash du PIN, SHA-256 en hexadécimal, **la même** que `SecretTokens.hash`
 * appliqué au hash (les cas d'usage passent par ce port). Chaque hash argon2 a son sel : tout
 * nouveau PIN, même de mêmes chiffres, change l'empreinte, donc invalide les déverrouillages donnés
 * par le précédent.
 */
export function pinStampOf(pinHash: string | null): string | null {
  return pinHash === null ? null : createHash('sha256').update(pinHash, 'utf8').digest('hex');
}
