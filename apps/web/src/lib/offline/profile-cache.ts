import type { QueryClient } from '@tanstack/react-query';
import { getGetSessionQueryKey, type SessionStatusView } from '@wishlist/api-client';
import {
  forgetVault,
  readDeviceMeta,
  readVault,
  reconcileDevice,
  recordVault,
  wipeDevice,
  writeDeviceMeta,
} from './device';
import { idbAvailable } from './idb';
import { fetchProfileKey, heldProfileKey, type ProfileKey } from './keys';
import { forgetQueries, persistQueries, restoreQueries } from './persist';
import { ProfileVault } from './vault';

/** Coffre ouvert, lectures restaurées, écriture en cours. */
export interface OpenProfileCache {
  readonly profileId: string;
  readonly vault: ProfileVault;
  /**
   * Arrête l'écriture, écrit une dernière fois et ferme la base. `discard` : sans dernière écriture
   * (l'identité a changé ailleurs). Le premier appel décide ; les suivants attendent le même arrêt.
   */
  readonly close: (options?: { discard?: boolean }) => Promise<void>;
}

/** OFF-29 : sur un appareil partagé, les coffres d'un autre compte sont effacés (rien n'est écrit). */
export async function wipeIfOtherAccount(accountTag: string): Promise<void> {
  if (!idbAvailable()) return;
  const meta = await readDeviceMeta();
  if (meta && meta.accountTag !== accountTag) await wipeDevice();
}

export class CacheOpeningCancelled extends Error {}

async function mount(
  queryClient: QueryClient,
  profileId: string,
  key: ProfileKey,
  now: number,
  isCurrent: () => boolean,
): Promise<OpenProfileCache> {
  const record = await readVault(profileId);
  const keyId = key.encrypted ? key.keyId : null;
  // OFF-26, OFF-29 : PIN posé, retiré ou changé, ou compte changé → l'ancien coffre ne se lit
  // plus ; il est effacé avant d'en ouvrir un neuf.
  if (record && (record.encrypted !== key.encrypted || record.keyId !== keyId)) {
    await forgetVault(profileId);
  }
  const vault = await ProfileVault.open(profileId, key.encrypted ? key.key : null);
  await restoreQueries(queryClient, vault, now, isCurrent);
  if (!isCurrent()) {
    vault.close();
    throw new CacheOpeningCancelled();
  }
  await recordVault({ profileId, encrypted: key.encrypted, keyId, lastOpenedAt: now });
  const stop = persistQueries(queryClient, vault, {
    // OFF-20 : la session de l'onglet, relue, dit encore que ce profil est le profil actif.
    isOwner: () => {
      const session = queryClient.getQueryData<SessionStatusView>(getGetSessionQueryKey());
      return !session?.session || session.session.activeProfileId === profileId;
    },
  });
  let closing: Promise<void> | null = null;
  return {
    profileId,
    vault,
    close: (options) => {
      closing ??= stop(options).then(() => {
        vault.close();
      });
      return closing;
    },
  };
}

/**
 * En ligne, profil actif déverrouillé (OFF-20, OFF-26) : purge de l'appareil pour ce compte,
 * clé demandée au serveur, coffre ouvert et relu. `null` si IndexedDB manque.
 */
export async function openOnline(input: {
  queryClient: QueryClient;
  accountTag: string;
  profileId: string;
  now: number;
  isCurrent: () => boolean;
}): Promise<OpenProfileCache | null> {
  if (!idbAvailable()) return null;
  await reconcileDevice(input.accountTag, input.now);
  const key = await fetchProfileKey(input.profileId);
  const opened = await mount(input.queryClient, input.profileId, key, input.now, input.isCurrent);
  await writeDeviceMeta({ accountTag: input.accountTag, lastProfileId: input.profileId });
  return opened;
}

export type OfflineOpening =
  | { readonly kind: 'opened'; readonly cache: OpenProfileCache }
  /** OFF-27 : profil à PIN dont la clé n'est plus en mémoire : le réseau est requis. */
  | { readonly kind: 'needs_network' }
  | { readonly kind: 'nothing' };

/**
 * Hors ligne au lancement (OFF-27) : le dernier profil actif de l'appareil, s'il a un coffre. Un
 * coffre chiffré ne s'ouvre qu'avec la clé obtenue en ligne dans cet onglet.
 */
export async function openOffline(input: {
  queryClient: QueryClient;
  now: number;
  isCurrent: () => boolean;
}): Promise<OfflineOpening> {
  if (!idbAvailable()) return { kind: 'nothing' };
  const meta = await readDeviceMeta();
  const profileId = meta?.lastProfileId;
  if (!profileId) return { kind: 'nothing' };
  const record = await readVault(profileId);
  if (!record) return { kind: 'nothing' };
  let key: ProfileKey = { encrypted: false };
  if (record.encrypted) {
    const held = heldProfileKey(profileId);
    if (!held || held.keyId !== record.keyId) return { kind: 'needs_network' };
    key = { encrypted: true, keyId: held.keyId, key: held.key };
  }
  return {
    kind: 'opened',
    cache: await mount(input.queryClient, profileId, key, input.now, input.isCurrent),
  };
}

/** Session perdue (`401`) : lectures du dernier profil effacées, file gardée (OFF-29). */
export async function forgetLastProfileReads(): Promise<void> {
  if (!idbAvailable()) return;
  const profileId = (await readDeviceMeta())?.lastProfileId;
  if (!profileId || !(await readVault(profileId))) return;
  const vault = await ProfileVault.open(profileId, null);
  try {
    await forgetQueries(vault);
  } finally {
    vault.close();
  }
}
