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
