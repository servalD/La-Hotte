import {
  deleteDatabase,
  idbAvailable,
  idbDelete,
  idbEntries,
  idbGet,
  idbPut,
  openDatabase,
} from './idb';
import { destroyProfileVault } from './vault';

/**
 * Base de l'appareil (OFF-28) : seulement de quoi retrouver et purger les coffres. Aucun titre,
 * nom, montant ni texte.
 */
const DEVICE_DB = 'lh-device';
const STORES = ['profiles', 'meta'] as const;

/** OFF-07 : un profil non ouvert depuis 30 jours perd son cache. */
export const CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface VaultRecord {
  readonly profileId: string;
  readonly encrypted: boolean;
  /** Identifiant de clé (OFF-26) ; `null` pour un profil sans PIN. */
  readonly keyId: string | null;
  readonly lastOpenedAt: number;
}

export interface DeviceMeta {
  /** Étiquette opaque du compte qui possède les coffres (OFF-29). */
  readonly accountTag: string;
  readonly lastProfileId: string | null;
}

async function withDevice<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDatabase(DEVICE_DB, STORES);
  try {
    return await run(db);
  } finally {
    db.close();
  }
}

export function readDeviceMeta(): Promise<DeviceMeta | undefined> {
  return withDevice((db) => idbGet<DeviceMeta>(db, 'meta', 'device'));
}

export function writeDeviceMeta(meta: DeviceMeta): Promise<void> {
  return withDevice((db) => idbPut(db, 'meta', 'device', meta));
}

export function listVaults(): Promise<VaultRecord[]> {
  return withDevice(async (db) =>
    (await idbEntries(db, 'profiles')).map((row) => row.value as VaultRecord),
  );
}

export function readVault(profileId: string): Promise<VaultRecord | undefined> {
  return withDevice((db) => idbGet<VaultRecord>(db, 'profiles', profileId));
}

export function recordVault(record: VaultRecord): Promise<void> {
  return withDevice((db) => idbPut(db, 'profiles', record.profileId, record));
}

export async function forgetVault(profileId: string): Promise<void> {
  await destroyProfileVault(profileId);
  await withDevice((db) => idbDelete(db, 'profiles', profileId));
}

/** OFF-22, OFF-29 : déconnexion ou autre compte, plus rien de l'ancien sur l'appareil. */
export async function wipeDevice(): Promise<void> {
  if (!idbAvailable()) return;
  const vaults = await listVaults().catch(() => [] as VaultRecord[]);
  await Promise.all(vaults.map((v) => destroyProfileVault(v.profileId)));
  await deleteDatabase(DEVICE_DB);
  await wipeCachedPages();
}

/**
 * Au lancement, pour le compte de la session : autre compte → tout effacer ; profil non ouvert
 * depuis 30 jours → son coffre effacé (OFF-07, OFF-29).
 */
export async function reconcileDevice(accountTag: string, now: number): Promise<void> {
  const meta = await readDeviceMeta();
  if (meta && meta.accountTag !== accountTag) {
    await wipeDevice();
    return;
  }
  for (const vault of await listVaults()) {
    if (now - vault.lastOpenedAt > CACHE_RETENTION_MS) await forgetVault(vault.profileId);
  }
  if (!meta) await writeDeviceMeta({ accountTag, lastProfileId: null });
}

/**
 * OFF-22 : les pages gardées par le service worker (`/lists/<id>`, …) ne survivent pas à la
 * déconnexion. Restent les fichiers du build et les pages de premier niveau, qui ne portent
 * aucun identifiant.
 */
export async function wipeCachedPages(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    for (const name of await caches.keys()) {
      if (!name.startsWith('lh-')) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const { pathname } = new URL(request.url);
        const deep = pathname.split('/').filter(Boolean).length > 1;
        if (!pathname.startsWith('/_next/') && deep) await cache.delete(request);
      }
    }
  } catch {
    // Le cache des pages est une commodité ; une erreur ne bloque pas la déconnexion.
  }
}
