// Enveloppe minimale d'IndexedDB en promesses (ADR 0020). Aucune bibliothèque : quatre opérations
// suffisent, et le cloisonnement se lit mieux sans couche de plus.

export const PROFILE_STORES = ['cache', 'queue', 'images'] as const;
export type ProfileStoreName = (typeof PROFILE_STORES)[number];

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB'));
    };
  });
}

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Ouvre (et crée au besoin) une base dont chaque magasin est clé → valeur. */
export function openDatabase(name: string, stores: readonly string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      for (const store of stores) {
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Une autre fenêtre efface la base (purge) : on cède tout de suite.
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB'));
    };
    request.onblocked = () => {
      reject(new Error('IndexedDB bloquée'));
    };
  });
}

export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    // Bloquée ou en erreur : on ne retient pas l'appelant ; la purge se refera au prochain lancement.
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      resolve();
    };
    request.onblocked = () => {
      resolve();
    };
  });
}

export async function idbGet<T>(
  db: IDBDatabase,
  store: string,
  key: string,
): Promise<T | undefined> {
  return (await promised(db.transaction(store).objectStore(store).get(key))) as T | undefined;
}

export async function idbPut(
  db: IDBDatabase,
  store: string,
  key: string,
  value: unknown,
): Promise<void> {
  await promised(db.transaction(store, 'readwrite').objectStore(store).put(value, key));
}

export async function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  await promised(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export async function idbClear(db: IDBDatabase, store: string): Promise<void> {
  await promised(db.transaction(store, 'readwrite').objectStore(store).clear());
}

export async function idbEntries(
  db: IDBDatabase,
  store: string,
): Promise<{ key: string; value: unknown }[]> {
  const os = db.transaction(store).objectStore(store);
  const [keys, values] = await Promise.all([promised(os.getAllKeys()), promised(os.getAll())]);
  return keys.map((key, i) => ({
    key: typeof key === 'string' ? key : JSON.stringify(key),
    value: values[i] as unknown,
  }));
}
