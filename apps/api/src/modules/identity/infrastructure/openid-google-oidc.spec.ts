import { randomBytes } from 'node:crypto';
import {
  type FakeOidcProvider,
  startFakeOidcProvider,
} from '../../../../test/support/fake-oidc-provider';
import type { AppConfig } from '../../../platform/config/env';
import { GoogleRejectedError, GoogleUnavailableError } from '../domain/google.errors';
import { IdentityUnavailableError } from '../domain/session.errors';
import { GOOGLE_CALLBACK_PATH, OpenIdGoogleOidc } from './openid-google-oidc';

// Adaptateur `openid-client` contre un fournisseur local (ADR 0003, ADR 0013 « Retour OIDC »,
// AUTH-03, AUTH-14) : ce que la bibliothèque vérifie pour nous est vérifié ici, une affirmation à
// la fois.

const WEB_ORIGIN = 'http://localhost:3000';
let provider: FakeOidcProvider;

beforeAll(async () => {
  provider = await startFakeOidcProvider();
});

afterAll(async () => {
  await provider.close();
});

afterEach(() => {
  provider.failTokenEndpoint(null);
});

function adapter(overrides: Record<string, unknown> = {}): OpenIdGoogleOidc {
  const env = {
    NODE_ENV: 'test',
    WEB_ORIGIN,
    GOOGLE_CLIENT_ID: provider.clientId,
    GOOGLE_CLIENT_SECRET: provider.clientSecret,
    GOOGLE_OIDC_ISSUER: provider.issuer,
    ...overrides,
  };
  return new OpenIdGoogleOidc({ env } as unknown as AppConfig);
}

const secret = (): string => randomBytes(32).toString('base64url');

async function flow(
  google: OpenIdGoogleOidc,
  idToken: Record<string, unknown> = {},
  options: { fresh?: boolean; tamper?: (query: URLSearchParams) => void } = {},
) {
  const input = {
    state: secret(),
    nonce: secret(),
    codeVerifier: secret(),
    fresh: options.fresh ?? false,
  };
  const url = await google.authorizationUrl(input);
  const code = provider.issueCode(url, idToken);
  const query = new URLSearchParams({ state: input.state, code });
  options.tamper?.(query);
  return {
    url: new URL(url),
    exchange: () => google.exchange({ ...input, callbackQuery: query.toString() }),
  };
}

describe('OpenIdGoogleOidc', () => {
  it('URL : code + PKCE S256, portées openid email seules, URI de retour de l’API', async () => {
    const { url } = await flow(adapter());
    const params = url.searchParams;
    expect(`${url.origin}${url.pathname}`).toBe(`${provider.issuer}/auth`);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('openid email');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('client_id')).toBe(provider.clientId);
    expect(params.get('redirect_uri')).toBe(`${WEB_ORIGIN}${GOOGLE_CALLBACK_PATH}`);
    expect(params.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.has('max_age')).toBe(false);
    // AUTH-03 : le choix du compte Google est toujours demandé.
    expect(params.get('prompt')).toBe('select_account');
    // Le vérificateur ne part jamais dans l'URL.
    expect(url.href).not.toContain('code_verifier');
  });

  it('affirmations retenues : sub, adresse, vérification', async () => {
    const { exchange } = await flow(adapter());
    await expect(exchange()).resolves.toEqual({
      subject: '109876543210987654321',
      email: 'camille@gmail.test',
      emailVerified: true,
      authTime: null,
    });
    // Le secret du client et le vérificateur PKCE sont bien envoyés au point de terminaison.
    const sent = provider.tokenRequests.at(-1);
    expect(sent?.client_secret).toBe(provider.clientSecret);
    expect(sent?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('AUTH-03 : email_verified n’est vrai que pour le booléen true', async () => {
    for (const value of ['true', 1, undefined, false]) {
      const { exchange } = await flow(adapter(), { email_verified: value });
      expect((await exchange()).emailVerified).toBe(false);
    }
  });

  it.each([
    ['nonce', { nonce: 'un-autre-nonce' }],
    ['aud', { aud: 'un-autre-client' }],
    ['iss', { iss: 'https://accounts.example.test' }],
    ['exp', { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ['sub absent', { sub: undefined }],
    ['sub mal formé', { sub: 'avec espace' }],
  ])('jeton d’identité refusé : %s', async (_label, idToken) => {
    const { exchange } = await flow(adapter(), idToken);
    await expect(exchange()).rejects.toBeInstanceOf(GoogleRejectedError);
  });

  it('state du retour différent de celui du parcours : refusé', async () => {
    const { exchange } = await flow(
      adapter(),
      {},
      {
        tamper: (q) => {
          q.set('state', secret());
        },
      },
    );
    await expect(exchange()).rejects.toBeInstanceOf(GoogleRejectedError);
  });

  it('PKCE : un autre vérificateur est refusé par le fournisseur', async () => {
    const google = adapter();
    const input = { state: secret(), nonce: secret(), codeVerifier: secret(), fresh: false };
    const code = provider.issueCode(await google.authorizationUrl(input));
    await expect(
      google.exchange({
        ...input,
        codeVerifier: secret(),
        callbackQuery: new URLSearchParams({ state: input.state, code }).toString(),
      }),
    ).rejects.toBeInstanceOf(GoogleRejectedError);
  });

  it('code rejoué : refusé', async () => {
    const google = adapter();
    const input = { state: secret(), nonce: secret(), codeVerifier: secret(), fresh: false };
    const code = provider.issueCode(await google.authorizationUrl(input));
    const callbackQuery = new URLSearchParams({ state: input.state, code }).toString();
    await google.exchange({ ...input, callbackQuery });
    await expect(google.exchange({ ...input, callbackQuery })).rejects.toBeInstanceOf(
      GoogleRejectedError,
    );
  });

  it('annulation chez Google (error=access_denied) : refusé', async () => {
    const { exchange } = await flow(
      adapter(),
      {},
      {
        tamper: (q) => {
          q.delete('code');
          q.set('error', 'access_denied');
        },
      },
    );
    await expect(exchange()).rejects.toBeInstanceOf(GoogleRejectedError);
  });

  describe('AUTH-14 : fraîcheur', () => {
    const now = (): number => Math.floor(Date.now() / 1000);

    it('max_age=0 envoyé ; auth_time récent accepté', async () => {
      const { url, exchange } = await flow(adapter(), { auth_time: now() - 10 }, { fresh: true });
      expect(url.searchParams.get('max_age')).toBe('0');
      await expect(exchange()).resolves.toMatchObject({ subject: '109876543210987654321' });
    });

    it.each([
      ['auth_time ancien', { auth_time: now() - 3600 }],
      ['auth_time absent', {}],
    ])('refusé : %s', async (_label, idToken) => {
      const { exchange } = await flow(adapter(), idToken, { fresh: true });
      await expect(exchange()).rejects.toBeInstanceOf(GoogleRejectedError);
    });
  });

  it('fournisseur en panne (5xx) : indisponible, pas refusé', async () => {
    const { exchange } = await flow(adapter());
    provider.failTokenEndpoint(503);
    await expect(exchange()).rejects.toBeInstanceOf(IdentityUnavailableError);
  });

  it('fournisseur injoignable : indisponible', async () => {
    const google = adapter({ GOOGLE_OIDC_ISSUER: 'http://127.0.0.1:9' });
    await expect(
      google.authorizationUrl({
        state: secret(),
        nonce: secret(),
        codeVerifier: secret(),
        fresh: false,
      }),
    ).rejects.toBeInstanceOf(IdentityUnavailableError);
  });

  it('non configuré : GoogleUnavailableError', async () => {
    const google = adapter({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined });
    expect(google.enabled).toBe(false);
    await expect(
      google.authorizationUrl({
        state: secret(),
        nonce: secret(),
        codeVerifier: secret(),
        fresh: false,
      }),
    ).rejects.toBeInstanceOf(GoogleUnavailableError);
  });

  it('production : un émetteur http: n’est jamais accepté', async () => {
    const google = adapter({ NODE_ENV: 'production' });
    await expect(
      google.authorizationUrl({
        state: secret(),
        nonce: secret(),
        codeVerifier: secret(),
        fresh: false,
      }),
    ).rejects.toBeInstanceOf(IdentityUnavailableError);
  });
});
