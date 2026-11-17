import { getOwnCacheKey } from '@wishlist/api-client';
import { importCacheKey } from './crypto';

/**
 * Clés de cache des profils à PIN, gardées dans la mémoire de l'onglet seulement (OFF-21,
 * OFF-26). Un verrouillage, une déconnexion ou un rechargement les perd : il faut alors le réseau.
 */
const keys = new Map<string, { keyId: string; key: CryptoKey }>();

export type ProfileKey =
  | { readonly encrypted: false }
  | { readonly encrypted: true; readonly keyId: string; readonly key: CryptoKey };

/** Demande la clé au serveur (profil déverrouillé), et la retient pour l'onglet. */
export async function fetchProfileKey(profileId: string): Promise<ProfileKey> {
  const answer = await getOwnCacheKey();
  if (!answer.encrypted || !answer.key || !answer.keyId) {
    keys.delete(profileId);
    return { encrypted: false };
  }
  const key = await importCacheKey(answer.key);
  keys.set(profileId, { keyId: answer.keyId, key });
  return { encrypted: true, keyId: answer.keyId, key };
}

/** Clé déjà obtenue dans cet onglet (réouverture hors ligne sans rechargement, OFF-27). */
export function heldProfileKey(profileId: string): { keyId: string; key: CryptoKey } | null {
  return keys.get(profileId) ?? null;
}

/** Verrouillage, déconnexion : plus aucune clé en mémoire. */
export function forgetProfileKeys(): void {
  keys.clear();
}
