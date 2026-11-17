// @vitest-environment node
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVICE_WORKER_SOURCE } from './service-worker-source';

// PWA-07, OFF-01, OFF-24 (ADR 0020) : le service worker ne touche jamais à l'API, ne met en cache
// ni page de compte ni réponse autre que GET, et sert l'enveloppe hors ligne.

type Handler = (event: unknown) => void;
const ORIGIN = 'https://lahotte.test';

function harness(network: (url: string) => Promise<Response>) {
  const handlers = new Map<string, Handler>();
  const store = new Map<string, Response>();
  const cache = {
    match: (key: string | Request) =>
      Promise.resolve(
        store.get(typeof key === 'string' ? key : new URL(key.url).pathname)?.clone(),
      ),
    put: (key: string | Request, response: Response) => {
      store.set(typeof key === 'string' ? key : new URL(key.url).pathname, response);
      return Promise.resolve();
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) },
    skipWaiting: vi.fn(),
  };
  const caches = {
    open: () => Promise.resolve(cache),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
  };
  const fetchMock = vi.fn((input: string | Request) =>
    network(typeof input === 'string' ? input : input.url),
  );
  runInNewContext(SERVICE_WORKER_SOURCE, {
    self,
    caches,
    fetch: fetchMock,
    URL,
    Response,
    Promise,
    Set,
  });

  async function dispatch(request: {
    url: string;
    method?: string;
    mode?: string;
  }): Promise<Response | null> {
    const box: { responded: Promise<Response> | null } = { responded: null };
    handlers.get('fetch')?.({
      request: { method: 'GET', mode: 'cors', ...request },
      respondWith: (r: Promise<Response>) => {
        box.responded = r;
      },
    });
    return box.responded ? box.responded : null;
  }
  async function install() {
    let done: Promise<unknown> = Promise.resolve();
    handlers.get('install')?.({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  }
  return { dispatch, install, store, fetchMock };
}

const html = (body: string) =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });

function basic(response: Response): Response {
  Object.defineProperty(response, 'type', { value: 'basic' });
  return response;
}

let online = true;
const network = (url: string) =>
  online
    ? Promise.resolve(
        basic(
          url.includes('/_next/static/')
            ? new Response('chunk')
            : html(`<script src="/_next/static/chunks/app.js"></script> page ${url}`),
        ),
      )
    : Promise.reject(new TypeError('Failed to fetch'));

beforeEach(() => {
  online = true;
});

describe('Service worker (PWA-07, OFF-24)', () => {
  it('ne répond jamais à la place de l’API, du temps réel ni d’une mutation', async () => {
    const sw = harness(network);
    expect(await sw.dispatch({ url: `${ORIGIN}/api/v1/lists` })).toBeNull();
    expect(await sw.dispatch({ url: `${ORIGIN}/api/v1/images/abc` })).toBeNull();
    expect(await sw.dispatch({ url: `${ORIGIN}/realtime/?EIO=4` })).toBeNull();
    expect(
      await sw.dispatch({ url: `${ORIGIN}/lists`, method: 'POST', mode: 'navigate' }),
    ).toBeNull();
    expect(await sw.dispatch({ url: 'https://ailleurs.example/x', mode: 'navigate' })).toBeNull();
    expect(sw.store.size).toBe(0);
  });

  it('installation : enveloppe et fichiers statiques pré-cachés ; hors ligne, page ouverte ou enveloppe', async () => {
    const sw = harness(network);
    await sw.install();
    expect([...sw.store.keys()]).toEqual(
      expect.arrayContaining(['/', '/lists', '/cart', '/offline', '/_next/static/chunks/app.js']),
    );
    online = false;
    const lists = await sw.dispatch({ url: `${ORIGIN}/lists`, mode: 'navigate' });
    expect(await lists?.text()).toContain('page /lists');
    const unknown = await sw.dispatch({ url: `${ORIGIN}/lists/123`, mode: 'navigate' });
    expect(await unknown?.text()).toContain('page /offline');
  });

  it('push (NOT-06, PWA-04) : texte borné, lien gardé dans l’application', () => {
    const shown: { title: string; options: { body: string; data: { url: string } } }[] = [];
    const handlers = new Map<string, (event: unknown) => void>();
    runInNewContext(SERVICE_WORKER_SOURCE, {
      self: {
        location: { origin: ORIGIN },
        addEventListener: (type: string, handler: (event: unknown) => void) =>
          handlers.set(type, handler),
        registration: {
          showNotification: (title: string, options: { body: string; data: { url: string } }) => {
            shown.push({ title, options });
            return Promise.resolve();
          },
        },
        clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) },
      },
      caches: {},
      fetch: () => Promise.reject(new Error('hors test')),
      URL,
      Response,
      Promise,
      Set,
    });
    const push = (payload: unknown) =>
      handlers.get('push')?.({
        data: { json: () => payload },
        waitUntil: () => undefined,
      });
    push({ title: 'Pour Léa', body: 'Un nouveau message', url: '/notifications' });
    push({ title: 'x'.repeat(500), body: 'y', url: 'https://piege.example/' });
    push({ title: 'z', body: 'w', url: '//piege.example/' });
    expect(shown[0]).toMatchObject({
      title: 'Pour Léa',
      options: { body: 'Un nouveau message', data: { url: '/notifications' } },
    });
    expect(shown[1]?.title).toHaveLength(80);
    expect(shown[1]?.options.data.url).toBe('/notifications');
    expect(shown[2]?.options.data.url).toBe('/notifications');
  });

  it('pages de connexion, de compte, de profils : jamais mises en cache', async () => {
    const sw = harness(network);
    for (const path of [
      '/auth/login',
      '/account/security',
      '/profiles/unlock',
      '/invitations/open',
    ]) {
      await sw.dispatch({ url: `${ORIGIN}${path}`, mode: 'navigate' });
    }
    expect([...sw.store.keys()].filter((k) => /auth|account|profiles|invitations/.test(k))).toEqual(
      [],
    );
  });
});
