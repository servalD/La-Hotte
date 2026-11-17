import { isSealed, seal, unseal } from './crypto';
import {
  deleteDatabase,
  idbClear,
  idbDelete,
  idbEntries,
  idbGet,
  idbPut,
  openDatabase,
  PROFILE_STORES,
  type ProfileStoreName,
} from './idb';

/** OFF-28 : une base par profil, rien d'autre que ses lectures, ses images et sa file. */
export const profileDatabaseName = (profileId: string) => `lh-p-${profileId}`;

/**
 * Coffre d'un profil (OFF-20, OFF-21) : chiffré quand `key` est donnée (profil à PIN), en clair
 * sinon. Un enregistrement illisible (mauvaise clé, autre profil) est traité comme absent.
 */
export class ProfileVault {
  private constructor(
    readonly profileId: string,
    private readonly db: IDBDatabase,
    private readonly key: CryptoKey | null,
  ) {}

  static async open(profileId: string, key: CryptoKey | null): Promise<ProfileVault> {
    return new ProfileVault(
      profileId,
      await openDatabase(profileDatabaseName(profileId), PROFILE_STORES),
      key,
    );
  }

  get encrypted(): boolean {
    return this.key !== null;
  }

  async read<T>(store: ProfileStoreName, id: string): Promise<T | undefined> {
    const raw = await idbGet<unknown>(this.db, store, id);
    return raw === undefined ? undefined : this.decode<T>(store, raw);
  }

  async write(store: ProfileStoreName, id: string, value: unknown): Promise<void> {
    await idbPut(this.db, store, id, await this.encode(store, value));
  }

  async remove(store: ProfileStoreName, id: string): Promise<void> {
    await idbDelete(this.db, store, id);
  }

  async clear(store: ProfileStoreName): Promise<void> {
    await idbClear(this.db, store);
  }

  async entries(store: ProfileStoreName): Promise<{ key: string; value: unknown }[]> {
    const rows = await idbEntries(this.db, store);
    const out: { key: string; value: unknown }[] = [];
    for (const row of rows) {
      const value = await this.decode<unknown>(store, row.value);
      if (value !== undefined) out.push({ key: row.key, value });
    }
    return out;
  }

  close(): void {
    this.db.close();
  }

  private async encode(store: ProfileStoreName, value: unknown): Promise<unknown> {
    if (!this.key) return { plain: JSON.stringify(value) };
    return seal(this.key, this.profileId, store, value);
  }

  private async decode<T>(store: ProfileStoreName, raw: unknown): Promise<T | undefined> {
    try {
      if (this.key) {
        // Un enregistrement en clair dans un coffre chiffré ne se lit jamais (PIN posé depuis).
        return isSealed(raw) ? await unseal<T>(this.key, this.profileId, store, raw) : undefined;
      }
      if (
        typeof raw === 'object' &&
        raw !== null &&
        typeof (raw as { plain?: unknown }).plain === 'string'
      ) {
        return JSON.parse((raw as { plain: string }).plain) as T;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}

export function destroyProfileVault(profileId: string): Promise<void> {
  return deleteDatabase(profileDatabaseName(profileId));
}
