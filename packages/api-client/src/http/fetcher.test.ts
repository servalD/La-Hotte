import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError, setCsrfTokenSource } from './fetcher';

// API-21 : toute mutation porte X-CSRF-Token ; X-User-Activity seulement sur une action de l'utilisateur.
describe('apiFetch (API-21)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfTokenSource(() => 'jeton-csrf');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfTokenSource(null);
  });

  const headersOf = () =>
    new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);

  it('recopie le jeton CSRF sur une mutation', async () => {
    await apiFetch('/api/v1/auth/login', { method: 'POST', body: '{}' });
    expect(headersOf().get('X-CSRF-Token')).toBe('jeton-csrf');
  });

  it('ne pose pas le jeton CSRF sur une lecture', async () => {
    await apiFetch('/api/v1/session', { method: 'GET' });
    expect(headersOf().has('X-CSRF-Token')).toBe(false);
  });

  it('pose X-User-Activity sur une mutation, jamais sur une lecture automatique', async () => {
    await apiFetch('/api/v1/session/lock', { method: 'POST' });
    expect(headersOf().get('X-User-Activity')).toBe('1');
    fetchMock.mockClear();
    await apiFetch('/api/v1/profiles/me', { method: 'GET' });
    expect(headersOf().has('X-User-Activity')).toBe(false);
  });

  it("laisse l'appelant poser X-User-Activity sur une lecture voulue (navigation)", async () => {
    await apiFetch('/api/v1/profiles/me', { method: 'GET', headers: { 'X-User-Activity': '1' } });
    expect(headersOf().get('X-User-Activity')).toBe('1');
  });

  it('API-16 : une mutation reçoit une clé d’idempotence, sauf si l’appelant fixe la sienne', async () => {
    await apiFetch('/api/v1/products', { method: 'POST', body: '{}' });
    expect(headersOf().get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    fetchMock.mockClear();
    await apiFetch('/api/v1/products', {
      method: 'POST',
      body: '{}',
      headers: { 'Idempotency-Key': 'cle-fixee-par-la-file' },
    });
    expect(headersOf().get('Idempotency-Key')).toBe('cle-fixee-par-la-file');
    fetchMock.mockClear();
    await apiFetch('/api/v1/session', { method: 'GET' });
    expect(headersOf().has('Idempotency-Key')).toBe(false);
  });

  it('OFF-08 : une image revient en Blob, pas en JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/webp' },
      }),
    );
    const blob = await apiFetch<Blob>('/api/v1/images/abc');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(3);
  });

  it('lève une ApiError avec le code stable', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'PIN_INVALID', status: 403, title: 'x', type: 'x' }), {
        status: 403,
      }),
    );
    await expect(apiFetch('/x', { method: 'POST' })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('Retry-After', () => {
  it("est porté par l'ApiError (attente du PIN, PIN-03)", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: 'PIN_RATE_LIMITED', status: 429, title: 'x', type: 'x' }),
          {
            status: 429,
            headers: { 'Retry-After': '60' },
          },
        ),
      ),
    );
    const error = (await apiFetch('/x', { method: 'POST' }).catch((e: unknown) => e)) as ApiError;
    expect(error.retryAfter).toBe(60);
    vi.unstubAllGlobals();
  });
});

describe('jeton CSRF sans session (API-21)', () => {
  const session = (token: string) =>
    new Response(JSON.stringify({ csrfToken: token, authenticated: false }), { status: 200 });

  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfTokenSource(null);
  });

  it('un navigateur neuf demande GET /session avant la première mutation', async () => {
    setCsrfTokenSource(null);
    const mock = vi
      .fn()
      .mockResolvedValueOnce(session('pre-1'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mock);
    await apiFetch('/api/v1/auth/login', { method: 'POST', body: '{}' });
    const first = mock.mock.calls[0] as [string, RequestInit];
    const second = mock.mock.calls[1] as [string, RequestInit];
    expect(first[0]).toBe('/api/v1/session');
    expect(new Headers(second[1].headers).get('X-CSRF-Token')).toBe('pre-1');
  });

  it('un jeton refusé est redemandé une fois, puis la mutation est rejouée', async () => {
    setCsrfTokenSource(null);
    const refused = () =>
      new Response(JSON.stringify({ code: 'CSRF_REJECTED', status: 403, title: 'x', type: 'x' }), {
        status: 403,
      });
    const mock = vi
      .fn()
      .mockResolvedValueOnce(session('vieux'))
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(session('neuf'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mock);
    await apiFetch('/api/v1/auth/login', { method: 'POST', body: '{}' });
    expect(mock).toHaveBeenCalledTimes(4);
    const last = mock.mock.calls[3] as [string, RequestInit];
    expect(new Headers(last[1].headers).get('X-CSRF-Token')).toBe('neuf');
  });

  it('ne rejoue pas indéfiniment : un second refus devient une ApiError', async () => {
    setCsrfTokenSource(null);
    const refused = () =>
      new Response(JSON.stringify({ code: 'CSRF_REJECTED', status: 403, title: 'x', type: 'x' }), {
        status: 403,
      });
    const mock = vi
      .fn()
      .mockResolvedValueOnce(session('a'))
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(session('b'))
      .mockResolvedValueOnce(refused());
    vi.stubGlobal('fetch', mock);
    await expect(apiFetch('/x', { method: 'POST' })).rejects.toBeInstanceOf(ApiError);
    expect(mock).toHaveBeenCalledTimes(4);
  });
});
