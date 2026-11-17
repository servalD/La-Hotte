/**
 * Source du service worker (PWA-07, OFF-01, OFF-24, ADR 0020). Écrit à la main, sans
 * bibliothèque : il ne fait que trois choses, et ce qu'il ne fait pas compte autant.
 *
 * - Fichiers statiques du build (`/_next/static/…`, noms à empreinte) : cache d'abord.
 * - Pages de l'application : réseau d'abord ; sans réseau, la page déjà ouverte, sinon `/offline`.
 *   Ces pages ne portent aucune donnée (les écrans lisent l'API côté client) ; les pages de
 *   connexion, de compte, de profils et à jeton ne sont jamais mises en cache.
 * - Jamais : `/api`, `/realtime`, `/monitoring`, ni aucune requête autre que `GET`. Les données
 *   vivent dans le coffre du profil (OFF-20), pas dans ce cache commun à l'appareil.
 *
 * Exporté en chaîne pour être servi par `app/sw.js/route.ts` ; testé en l'exécutant dans un
 * faux contexte de service worker.
 */
export const SERVICE_WORKER_SOURCE = String.raw`'use strict';
const VERSION = '__LH_VERSION__';
const SHELL = 'lh-shell-' + VERSION;
const OFFLINE = '/offline';
const PRECACHE = ['/', '/lists', '/events', '/cart', '/balances', '/gifts', '/notifications', '/actions', OFFLINE];
const NEVER = ['/api/', '/realtime', '/monitoring', '/sw.js'];
const NO_PAGE_CACHE = ['/auth', '/account', '/accounts', '/profiles', '/invitations', '/transfers', '/settings'];

const startsWithAny = (path, list) => list.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : p + '/') || path.startsWith(p + '?'));

function staticAssetsOf(html) {
  const found = new Set();
  const re = /(?:src|href)="(\/_next\/static\/[^"#?]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) found.add(m[1]);
  return [...found];
}

async function cachePage(cache, path) {
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'follow' });
  if (!response.ok || response.redirected || response.type !== 'basic') return;
  const html = await response.clone().text();
  await cache.put(path, response);
  await Promise.all(
    staticAssetsOf(html).map(async (asset) => {
      if (await cache.match(asset)) return;
      const r = await fetch(asset);
      if (r.ok) await cache.put(asset, r);
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      Promise.all(PRECACHE.map((path) => cachePage(cache, path).catch(() => undefined))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lh-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  // PWA-06 : la nouvelle version ne prend la main que sur demande de l'utilisateur.
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// OFF-16 : synchronisation en arrière-plan, là où le navigateur la propose : réveille la file.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'lh-queue') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) client.postMessage({ type: 'lh-replay-queue' });
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (startsWithAny(url.pathname, NEVER)) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode !== 'navigate') return;
  const cacheable = !startsWithAny(url.pathname, NO_PAGE_CACHE);
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      try {
        const response = await fetch(request);
        if (cacheable && response.ok && !response.redirected && response.type === 'basic') {
          await cache.put(url.pathname, response.clone());
        }
        return response;
      } catch (error) {
        const page = cacheable ? await cache.match(url.pathname) : undefined;
        return page || (await cache.match(OFFLINE)) || Response.error();
      }
    })(),
  );
});
`;
