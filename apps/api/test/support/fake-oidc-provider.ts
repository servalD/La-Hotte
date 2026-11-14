import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Fournisseur OpenID Connect local (tests de l'adaptateur `openid-client` et de non-fuite) :
 * découverte, point de terminaison de jetons, jeton d'identité RS256. Il vérifie lui-même la
 * preuve PKCE, le secret du client et l'URI de redirection, comme Google. Chaque code est à usage
 * unique ; `idToken` permet de fausser une affirmation pour vérifier que l'adaptateur la refuse.
 */
export interface FakeOidcProvider {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Code délivré pour l'URL d'autorisation donnée ; affirmations par défaut, à surcharger. */
  issueCode(authorizationUrl: string, idToken?: Record<string, unknown>): string;
  /** Prochaines réponses du point de terminaison de jetons : statut forcé. */
  failTokenEndpoint(status: number | null): void;
  /** Requêtes reçues par le point de terminaison de jetons (corps décodé). */
  readonly tokenRequests: Array<Record<string, string>>;
  close(): Promise<void>;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeOidcProvider(): Promise<FakeOidcProvider> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const clientId = `client-${randomBytes(4).toString('hex')}`;
  const clientSecret = randomBytes(16).toString('hex');
  const codes = new Map<
    string,
    { challenge: string; redirectUri: string; claims: Record<string, unknown> }
  >();
  const tokenRequests: Array<Record<string, string>> = [];
  let forcedStatus: number | null = null;
  let issuer = '';

  const sign = (claims: Record<string, unknown>): string => {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }));
    const payload = b64url(JSON.stringify(claims));
    const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey);
    return `${header}.${payload}.${b64url(signature)}`;
  };

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', issuer);
      const json = (status: number, body: unknown): void => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      if (url.pathname === '/.well-known/openid-configuration') {
        json(200, {
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        });
        return;
      }
      if (url.pathname === '/jwks') {
        json(200, { keys: [jwk] });
        return;
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        const form = Object.fromEntries(new URLSearchParams(await readBody(request)));
        tokenRequests.push(form);
        if (forcedStatus !== null) {
          json(forcedStatus, { error: 'server_error' });
          return;
        }
        const entry = codes.get(form.code ?? '');
        codes.delete(form.code ?? '');
        const verifierChallenge = b64url(
          createHash('sha256')
            .update(form.code_verifier ?? '')
            .digest(),
        );
        if (
          !entry ||
          entry.challenge !== verifierChallenge ||
          entry.redirectUri !== form.redirect_uri ||
          form.client_id !== clientId ||
          form.client_secret !== clientSecret ||
          form.grant_type !== 'authorization_code'
        ) {
          json(400, { error: 'invalid_grant' });
          return;
        }
        json(200, {
          access_token: b64url(randomBytes(16)),
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: sign(entry.claims),
        });
        return;
      }
      json(404, { error: 'not_found' });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    clientId,
    clientSecret,
    tokenRequests,
    issueCode(authorizationUrl, idToken = {}) {
      const params = new URL(authorizationUrl).searchParams;
      const now = Math.floor(Date.now() / 1000);
      const code = b64url(randomBytes(16));
      codes.set(code, {
        challenge: params.get('code_challenge') ?? '',
        redirectUri: params.get('redirect_uri') ?? '',
        claims: {
          iss: issuer,
          aud: clientId,
          sub: '109876543210987654321',
          email: 'camille@gmail.test',
          email_verified: true,
          nonce: params.get('nonce'),
          iat: now,
          exp: now + 300,
          ...idToken,
        },
      });
      return code;
    },
    failTokenEndpoint(status) {
      forcedStatus = status;
    },
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}
