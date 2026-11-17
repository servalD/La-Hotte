import { getImage } from '@wishlist/api-client';
import type { ProfileVault } from './vault';

/**
 * OFF-05, OFF-08 : images des fiches dans le coffre du profil (chiffrées pour un profil à PIN),
 * jamais dans un cache commun du navigateur. 30 Mo au plus ; les moins récemment affichées
 * partent d'abord.
 */
export const IMAGE_CACHE_LIMIT_BYTES = 30 * 1024 * 1024;
const INDEX = '__index';

interface StoredImage {
  readonly type: string;
  /** Contenu en base64 : le coffre chiffre du JSON. */
  readonly data: string;
}

type ImageIndex = Partial<Record<string, { size: number; usedAt: number }>>;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function touch(vault: ProfileVault, key: string, size: number, now: number): Promise<void> {
  const index = new Map(Object.entries((await vault.read<ImageIndex>('images', INDEX)) ?? {}));
  index.set(key, { size, usedAt: now });
  let total = 0;
  for (const entry of index.values()) total += entry?.size ?? 0;
  const oldest = [...index.entries()].sort((a, b) => (a[1]?.usedAt ?? 0) - (b[1]?.usedAt ?? 0));
  for (const [victim, entry] of oldest) {
    if (total <= IMAGE_CACHE_LIMIT_BYTES || victim === key) continue;
    await vault.remove('images', victim);
    index.delete(victim);
    total -= entry?.size ?? 0;
  }
  await vault.write('images', INDEX, Object.fromEntries(index));
}

/** Image du coffre, sinon de l'API (gardée ensuite) ; `null` si ni l'un ni l'autre. */
export async function loadImage(
  vault: ProfileVault,
  key: string,
  options: { online: boolean; now?: number } = { online: true },
): Promise<Blob | null> {
  const now = options.now ?? Date.now();
  const stored = await vault.read<StoredImage>('images', key);
  if (stored) {
    const bytes = fromBase64(stored.data);
    void touch(vault, key, bytes.length, now).catch(() => undefined);
    return new Blob([bytes], { type: stored.type });
  }
  if (!options.online) return null;
  const blob = await getImage(key);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length <= IMAGE_CACHE_LIMIT_BYTES) {
    await vault.write('images', key, {
      type: blob.type,
      data: toBase64(bytes),
    } satisfies StoredImage);
    await touch(vault, key, bytes.length, now);
  }
  return blob;
}
