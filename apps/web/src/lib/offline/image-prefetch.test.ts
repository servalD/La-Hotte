// @vitest-environment node
import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { importCacheKey } from './crypto';
import { idbEntries, openDatabase, PROFILE_STORES } from './idb';
import { IMAGE_CACHE_LIMIT_BYTES, loadImage } from './image-cache';
import { prefetchAllowed, prefetchUpcoming } from './prefetch';
import { profileDatabaseName, ProfileVault } from './vault';

// OFF-05, OFF-08 : images dans le coffre du profil, chiffrées, plafonnées ; OFF-09 : préchargement.

const images = vi.hoisted(() => ({ calls: 0, size: 16 }));
const api = vi.hoisted(() => ({
  events: [] as { id: string; date: string }[],
  lists: [] as { id: string }[],
}));

vi.mock('@wishlist/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wishlist/api-client')>();
  return {
    ...actual,
    getImage: () => {
      images.calls += 1;
      return Promise.resolve(
        new Blob([new Uint8Array(images.size).fill(7)], { type: 'image/webp' }),
      );
    },
    getListEventsQueryOptions: () => ({
      queryKey: ['/api/v1/events', { scope: 'upcoming' }],
      queryFn: () => Promise.resolve({ items: api.events }),
    }),
    getGetOneEventQueryOptions: (id: string) => ({
      queryKey: [`/api/v1/events/${id}`],
      queryFn: () => Promise.resolve({ id }),
    }),
    getListListsQueryOptions: (params: { eventId: string }) => ({
      queryKey: ['/api/v1/lists', params],
      queryFn: () => Promise.resolve({ items: api.lists }),
    }),
    getListItemsQueryOptions: (id: string) => ({
      queryKey: [`/api/v1/lists/${id}/items`],
      queryFn: () => Promise.resolve({ items: [] }),
    }),
  };
});

const P = '0193f5a0-0000-7000-8000-000000000009';

describe('Images du coffre (OFF-08)', () => {
  it('lue une fois par l’API, puis hors ligne depuis le coffre, chiffrée sur le disque', async () => {
    const key = await importCacheKey(Buffer.alloc(32, 5).toString('base64url'));
    const vault = await ProfileVault.open(P, key);
    images.calls = 0;
    const first = await loadImage(vault, 'img-1', { online: true });
    expect(first?.size).toBe(16);
    const offline = await loadImage(vault, 'img-1', { online: false });
    expect(offline?.size).toBe(16);
    expect(images.calls).toBe(1);
    expect(await loadImage(vault, 'inconnue', { online: false })).toBeNull();
    vault.close();
    const db = await openDatabase(profileDatabaseName(P), PROFILE_STORES);
    const rows = await idbEntries(db, 'images');
    db.close();
    expect(rows.every((r) => !('plain' in (r.value as object)))).toBe(true);
  });

  it('plafond : les images les moins récemment affichées partent d’abord', async () => {
    const vault = await ProfileVault.open(`${P}-cap`, null);
    images.size = Math.floor(IMAGE_CACHE_LIMIT_BYTES / 2) + 10;
    await loadImage(vault, 'a', { online: true, now: 1 });
    await loadImage(vault, 'b', { online: true, now: 2 });
    await loadImage(vault, 'c', { online: true, now: 3 });
    expect(await vault.read('images', 'a')).toBeUndefined();
    expect(await vault.read('images', 'c')).toBeDefined();
    images.size = 16;
    vault.close();
  }, 30_000);
});

describe('Préchargement (OFF-09)', () => {
  it('jamais en économie de données ni sur réseau cellulaire', () => {
    expect(prefetchAllowed({ saveData: true })).toBe(false);
    expect(prefetchAllowed({ type: 'cellular' })).toBe(false);
    expect(prefetchAllowed({ effectiveType: '2g' })).toBe(false);
    expect(prefetchAllowed({ type: 'wifi', effectiveType: '4g' })).toBe(true);
    expect(prefetchAllowed(undefined)).toBe(true);
  });

  it('événements sous 30 jours seulement, avec leurs listes et éléments ; une fois par heure', async () => {
    const now = Date.parse('2026-12-01T00:00:00Z');
    api.events = [
      { id: 'noel', date: '2026-12-24' },
      { id: 'paques', date: '2027-04-05' },
    ];
    api.lists = [{ id: 'liste-noel' }];
    const client = new QueryClient();
    expect(await prefetchUpcoming(client, { now, connection: { type: 'wifi' } })).toBe(1);
    expect(client.getQueryData(['/api/v1/lists/liste-noel/items'])).toEqual({ items: [] });
    expect(client.getQueryData(['/api/v1/events/paques'])).toBeUndefined();
    expect(await prefetchUpcoming(client, { now: now + 1_000, connection: { type: 'wifi' } })).toBe(
      0,
    );
  });
});
