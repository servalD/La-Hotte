// @vitest-environment node
import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@wishlist/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_RETENTION_MS,
  listVaults,
  readDeviceMeta,
  reconcileDevice,
  recordVault,
  wipeDevice,
  writeDeviceMeta,
} from './device';
import { idbEntries, openDatabase, PROFILE_STORES } from './idb';
import { forgetProfileKeys } from './keys';
import { isPersisted, persistQueries, restoreQueries, snapshotOf } from './persist';
import { forgetLastProfileReads, openOffline, openOnline } from './profile-cache';
import { profileDatabaseName, ProfileVault } from './vault';

// OFF-06, OFF-07, OFF-20 à OFF-29 (ADR 0020) : coffre par profil, chiffré pour un profil à PIN,
// liste fermée des lectures, purges.

interface KeyAnswer {
  encrypted: boolean;
  keyId: string | null;
  key: string | null;
}

const keyAnswer = vi.hoisted((): { value: KeyAnswer } => ({
  value: { encrypted: false, keyId: null, key: null },
}));

vi.mock('@wishlist/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wishlist/api-client')>();
  return { ...actual, getOwnCacheKey: () => Promise.resolve(keyAnswer.value) };
});

const P1 = '0193f5a0-0000-7000-8000-000000000001';
const P2 = '0193f5a0-0000-7000-8000-000000000002';
const LIST = '0193f5a0-0000-7000-8000-0000000000aa';
const SECRET = 'Vélo-rouge-de-Léa';
const rawKey = (fill: number) =>
  Buffer.alloc(32, fill)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function pinProfile(fill: number, keyId: string) {
  keyAnswer.value = { encrypted: true, keyId, key: rawKey(fill) };
}

function clientWith(data: Record<string, unknown>): QueryClient {
  const client = new QueryClient();
  for (const [key, value] of Object.entries(data)) client.setQueryData([key], value);
  return client;
}

async function rawContent(profileId: string): Promise<string> {
  const db = await openDatabase(profileDatabaseName(profileId), PROFILE_STORES);
  const rows = await idbEntries(db, 'cache');
  db.close();
  return rows
    .map((r) => {
      const v = r.value as { plain?: string; data?: ArrayBuffer };
      return v.plain ?? Buffer.from(v.data ?? new ArrayBuffer(0)).toString('latin1');
    })
    .join('|');
}

beforeEach(async () => {
  keyAnswer.value = { encrypted: false, keyId: null, key: null };
  forgetProfileKeys();
  await wipeDevice();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Liste fermée des lectures conservées (OFF-06)', () => {
  it('listes, éléments, événements, panier, comptes : oui ; session, compte, profil actif, cercle, justificatif : non', () => {
    for (const path of [
      '/api/v1/lists',
      `/api/v1/lists/${LIST}/items`,
      `/api/v1/items/${LIST}`,
      `/api/v1/items/${LIST}/comments`,
      `/api/v1/events/${LIST}/progress`,
      '/api/v1/cart',
      '/api/v1/balances',
      '/api/v1/notifications',
    ]) {
      expect({ path, kept: isPersisted([path]) }).toEqual({ path, kept: true });
    }
    for (const path of [
      '/api/v1/session',
      '/api/v1/sessions',
      '/api/v1/account',
      '/api/v1/account/profiles',
      '/api/v1/profiles/me',
      '/api/v1/profiles/me/cache-key',
      '/api/v1/circle',
      '/api/v1/trusted-devices',
      `/api/v1/items/${LIST}/purchase/receipt`,
    ]) {
      expect({ path, kept: isPersisted([path]) }).toEqual({ path, kept: false });
    }
  });

  it('une lecture refusée par l’API sort du coffre ; une relecture échouée faute de réseau y reste', () => {
    const client = clientWith({
      '/api/v1/cart': { groups: [] },
      '/api/v1/balances': { items: [] },
    });
    const cart = client.getQueryCache().find({ queryKey: ['/api/v1/cart'] });
    const balances = client.getQueryCache().find({ queryKey: ['/api/v1/balances'] });
    cart?.setState({
      status: 'error',
      error: new ApiError({ type: 'x', title: 'x', status: 404, code: 'NOT_FOUND' }),
    });
    balances?.setState({ status: 'error', error: new TypeError('Failed to fetch') });
    const keys = snapshotOf(client, Date.now()).state.queries.map((q) => q.queryKey[0]);
    expect(keys).toEqual(['/api/v1/balances']);
  });
});

describe('Coffre d’un profil (OFF-20, OFF-21, OFF-26)', () => {
  it('profil à PIN : rien de lisible sur le disque ; une autre clé ne lit rien', async () => {
    pinProfile(7, 'a'.repeat(32));
    const client = clientWith({ '/api/v1/lists': { items: [{ title: SECRET }] } });
    const opened = await openOnline({
      queryClient: client,
      accountTag: 'compte-1',
      profileId: P1,
      now: Date.now(),
      isCurrent: () => true,
    });
    await opened?.close();
    expect(await rawContent(P1)).not.toContain('Vélo');
    const stranger = await ProfileVault.open(P1, null);
    expect(await stranger.read('cache', 'state')).toBeUndefined();
    stranger.close();
    // Clé d'un autre PIN : rien.
    const { importCacheKey } = await import('./crypto');
    const other = await ProfileVault.open(P1, await importCacheKey(rawKey(9)));
    expect(await other.read('cache', 'state')).toBeUndefined();
    other.close();
  });

  it('relu au lancement suivant ; PIN changé → ancien coffre effacé, rien de l’ancien n’est relu', async () => {
    pinProfile(7, 'a'.repeat(32));
    const first = clientWith({ '/api/v1/lists': { items: [{ title: SECRET }] } });
    const opened = await openOnline({
      queryClient: first,
      accountTag: 'compte-1',
      profileId: P1,
      now: Date.now(),
      isCurrent: () => true,
    });
    await opened?.close();

    const again = new QueryClient();
    const reopened = await openOnline({
      queryClient: again,
      accountTag: 'compte-1',
      profileId: P1,
      now: Date.now(),
      isCurrent: () => true,
    });
    expect(again.getQueryData(['/api/v1/lists'])).toEqual({ items: [{ title: SECRET }] });
    await reopened?.close();

    pinProfile(8, 'b'.repeat(32));
    const afterPinChange = new QueryClient();
    const changed = await openOnline({
      queryClient: afterPinChange,
      accountTag: 'compte-1',
      profileId: P1,
      now: Date.now(),
      isCurrent: () => true,
    });
    expect(afterPinChange.getQueryData(['/api/v1/lists'])).toBeUndefined();
    await changed?.close();
  });

  it('OFF-20 : un changement de profil pendant la lecture du coffre n’y verse rien', async () => {
    const first = clientWith({ '/api/v1/lists': { items: [{ title: SECRET }] } });
    const opened = await openOnline({
      queryClient: first,
      accountTag: 'compte-1',
      profileId: P1,
      now: Date.now(),
      isCurrent: () => true,
    });
    await opened?.close();
    const other = new QueryClient();
    await expect(
      openOnline({
        queryClient: other,
        accountTag: 'compte-1',
        profileId: P1,
        now: Date.now(),
        isCurrent: () => false,
      }),
    ).rejects.toThrow();
    expect(other.getQueryData(['/api/v1/lists'])).toBeUndefined();
  });

  it('écrit peu après un changement ; arrêt synchrone pour l’écriture', async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const client = new QueryClient();
    const vault = await ProfileVault.open(P2, null);
    const stop = persistQueries(client, vault, { delayMs: 10 });
    client.setQueryData(['/api/v1/cart'], { groups: [1] });
    await wait(60);
    const ending = stop();
    // Après l'arrêt, une donnée d'un autre profil n'entre plus dans ce coffre.
    client.setQueryData(['/api/v1/cart'], { groups: ['autre profil'] });
    await ending;
    await wait(60);
    const restored = new QueryClient();
    await restoreQueries(restored, vault, Date.now());
    expect(restored.getQueryData(['/api/v1/cart'])).toEqual({ groups: [1] });
    vault.close();
  });
});

describe('Arrêt de l’écriture à un changement d’identité (OFF-20)', () => {
  it('discard : une lecture arrivée sous une autre identité n’entre pas dans le coffre', async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const client = new QueryClient();
    const vault = await ProfileVault.open(P2, null);
    const stop = persistQueries(client, vault, { delayMs: 10_000 });
    client.setQueryData(['/api/v1/balances'], { groups: ['vue d’un autre profil'] });
    await stop({ discard: true });
    await wait(30);
    const restored = new QueryClient();
    await restoreQueries(restored, vault, Date.now());
    expect(restored.getQueryData(['/api/v1/balances'])).toBeUndefined();
    vault.close();
  });
});

describe('Réouverture hors ligne (OFF-27)', () => {
  it('profil sans PIN : rouvert hors ligne ; profil à PIN : réseau requis sans clé en mémoire', async () => {
    const client = clientWith({ '/api/v1/cart': { groups: [] } });
    const opened = await openOnline({
      queryClient: client,
      accountTag: 'compte-1',
      profileId: P1,
      now: Date.now(),
      isCurrent: () => true,
    });
    await opened?.close();
    const offline = new QueryClient();
    const plain = await openOffline({
      queryClient: offline,
      now: Date.now(),
      isCurrent: () => true,
    });
    expect(plain.kind).toBe('opened');
    expect(offline.getQueryData(['/api/v1/cart'])).toEqual({ groups: [] });
    if (plain.kind === 'opened') await plain.cache.close();

    pinProfile(7, 'c'.repeat(32));
    const pin = await openOnline({
      queryClient: new QueryClient(),
      accountTag: 'compte-1',
      profileId: P2,
      now: Date.now(),
      isCurrent: () => true,
    });
    await pin?.close();
    // Même onglet : la clé est encore en mémoire.
    const sameTab = await openOffline({
      queryClient: new QueryClient(),
      now: Date.now(),
      isCurrent: () => true,
    });
    expect(sameTab.kind).toBe('opened');
    if (sameTab.kind === 'opened') await sameTab.cache.close();
    // Verrouillage ou rechargement : clé perdue.
    forgetProfileKeys();
    expect(
      (
        await openOffline({
          queryClient: new QueryClient(),
          now: Date.now(),
          isCurrent: () => true,
        })
      ).kind,
    ).toBe('needs_network');
  });
});

describe('Purges (OFF-07, OFF-22, OFF-29)', () => {
  it('autre compte : tout est effacé ; profil non ouvert depuis 30 jours : son coffre effacé', async () => {
    const now = Date.now();
    await writeDeviceMeta({ accountTag: 'compte-1', lastProfileId: P1 });
    await recordVault({ profileId: P1, encrypted: false, keyId: null, lastOpenedAt: now });
    await recordVault({
      profileId: P2,
      encrypted: false,
      keyId: null,
      lastOpenedAt: now - CACHE_RETENTION_MS - 1,
    });
    await reconcileDevice('compte-1', now);
    expect((await listVaults()).map((v) => v.profileId)).toEqual([P1]);
    await reconcileDevice('compte-2', now);
    expect(await listVaults()).toEqual([]);
    expect(await readDeviceMeta()).toBeUndefined();
  });

  it('déconnexion : aucune base de profil ne reste', async () => {
    const opened = await openOnline({
      queryClient: clientWith({ '/api/v1/lists': { items: [] } }),
      accountTag: 'compte-1',
      profileId: P1,
      now: Date.now(),
      isCurrent: () => true,
    });
    await opened?.close();
    await wipeDevice();
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names.filter((n) => n?.startsWith('lh-'))).toEqual([]);
  });

  it('session perdue (401) : les lectures du dernier profil sont effacées, la file reste', async () => {
    const opened = await openOnline({
      queryClient: clientWith({ '/api/v1/lists': { items: [] } }),
      accountTag: 'compte-1',
      profileId: P1,
      now: Date.now(),
      isCurrent: () => true,
    });
    await opened?.vault.write('queue', 'a1', { kind: 'comment' });
    await opened?.close();
    await forgetLastProfileReads();
    const vault = await ProfileVault.open(P1, null);
    expect(await vault.read('cache', 'state')).toBeUndefined();
    expect(await vault.read('queue', 'a1')).toEqual({ kind: 'comment' });
    vault.close();
  });
});
