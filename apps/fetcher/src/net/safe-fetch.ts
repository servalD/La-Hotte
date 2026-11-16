import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { isPublicAddress } from './address-policy.js';
import { FetchError } from './errors.js';

// EXT-40 à EXT-43 : récupération d'une URL fournie par un utilisateur. On résout le nom nous-mêmes,
// on refuse toute adresse non publique, et l'on se connecte à l'adresse déjà vérifiée (jamais de
// seconde résolution : pas de rebinding DNS). Chaque redirection repasse par les mêmes contrôles.

export const ALLOWED_PORTS = new Set([80, 443]);
export const MAX_REDIRECTS = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; LaHotteBot/1.0; +https://lahotte.app/robot)';

export interface NetworkPolicy {
  /** EXT-40 : ports joignables. */
  readonly ports: ReadonlySet<number>;
  /** Adresses du nom (toutes). */
  resolve(hostname: string): Promise<string[]>;
  /** Vrai si l'on peut se connecter à cette adresse et ce port. */
  allows(address: string, port: number): boolean;
}

export const PUBLIC_INTERNET: NetworkPolicy = {
  ports: ALLOWED_PORTS,
  async resolve(hostname) {
    const results = await lookup(hostname, { all: true, order: 'verbatim' });
    return results.map((result) => result.address);
  },
  allows(address, port) {
    return this.ports.has(port) && isPublicAddress(address);
  },
};

export interface FetchLimits {
  readonly maxBytes: number;
  readonly deadlineMs: number;
  /** Type de contenu attendu (sans paramètres, en minuscules). */
  readonly accepts: (contentType: string) => boolean;
  readonly accept: string;
}

export interface FetchedResource {
  readonly finalUrl: string;
  readonly contentType: string;
  readonly charset: string | null;
  readonly body: Buffer;
}

/** EXT-40 : schéma, port, identifiants. Lève `URL_REFUSED`. */
export function checkUrl(raw: string, base?: URL, ports: ReadonlySet<number> = ALLOWED_PORTS): URL {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    throw new FetchError('URL_REFUSED');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('URL_REFUSED');
  if (url.username || url.password) throw new FetchError('URL_REFUSED');
  if (!url.hostname) throw new FetchError('URL_REFUSED');
  const port = portOf(url);
  if (!ports.has(port)) throw new FetchError('URL_REFUSED');
  return url;
}

function portOf(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

/** Nom d'hôte sans crochets (IPv6 littérale). */
function bareHost(url: URL): string {
  return url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
}

/** EXT-41 : toutes les adresses du nom doivent être publiques ; on garde la première. */
async function pinAddress(url: URL, policy: NetworkPolicy): Promise<string> {
  const host = bareHost(url);
  const port = portOf(url);
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await policy.resolve(host);
    } catch {
      throw new FetchError('FETCH_FAILED');
    }
  }
  const [first] = addresses;
  if (first === undefined) throw new FetchError('FETCH_FAILED');
  if (addresses.some((address) => !policy.allows(address, port))) {
    throw new FetchError('URL_REFUSED');
  }
  return first;
}

function once(
  url: URL,
  address: string,
  signal: AbortSignal,
  accept: string,
): Promise<IncomingMessage> {
  const host = bareHost(url);
  const isHttps = url.protocol === 'https:';
  const send = isHttps ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      {
        host: address,
        port: portOf(url),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        signal,
        agent: false,
        // TLS : le certificat est vérifié contre le nom demandé, pas contre l'adresse.
        ...(isHttps && !isIP(host) ? { servername: host } : {}),
        headers: {
          Host: url.host,
          'User-Agent': USER_AGENT,
          Accept: accept,
          'Accept-Language': 'fr,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      resolve,
    );
    req.on('error', reject);
    req.end();
  });
}

function decoded(response: IncomingMessage): Readable {
  switch ((response.headers['content-encoding'] ?? '').toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return response.pipe(createGunzip());
    case 'deflate':
      return response.pipe(createInflate());
    case 'br':
      return response.pipe(createBrotliDecompress());
    default:
      return response;
  }
}

/** EXT-43 : corps borné, décompression comprise (pas de bombe de compression). */
async function readBounded(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers['content-length'] ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy();
    throw new FetchError('TOO_LARGE');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const stream = decoded(response);
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) {
      stream.destroy();
      response.destroy();
      throw new FetchError('TOO_LARGE');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseContentType(header: string | undefined): { type: string; charset: string | null } {
  const [type = '', ...params] = (header ?? '').split(';');
  const charset = params
    .map((param) => param.trim().toLowerCase())
    .find((param) => param.startsWith('charset='))
    ?.slice('charset='.length)
    .replace(/"/g, '');
  return { type: type.trim().toLowerCase(), charset: charset ?? null };
}

/**
 * Récupère une ressource (EXT-40 à EXT-43). Lève une `FetchError` au code stable, jamais une
 * erreur qui porterait l'URL.
 */
export async function safeFetch(
  raw: string,
  limits: FetchLimits,
  policy: NetworkPolicy = PUBLIC_INTERNET,
): Promise<FetchedResource> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, limits.deadlineMs);
  try {
    let url = checkUrl(raw, undefined, policy.ports);
    for (let redirects = 0; ; redirects += 1) {
      const address = await pinAddress(url, policy);
      let response: IncomingMessage;
      try {
        response = await once(url, address, controller.signal, limits.accept);
      } catch {
        throw new FetchError(controller.signal.aborted ? 'TIMEOUT' : 'FETCH_FAILED');
      }
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) throw new FetchError('TOO_MANY_REDIRECTS');
        url = checkUrl(response.headers.location, url, policy.ports); // EXT-42
        continue;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        throw new FetchError('UPSTREAM_STATUS');
      }
      const { type, charset } = parseContentType(response.headers['content-type']);
      if (!limits.accepts(type)) {
        response.destroy();
        throw new FetchError('BAD_TYPE');
      }
      let body: Buffer;
      try {
        body = await readBounded(response, limits.maxBytes);
      } catch (error) {
        if (error instanceof FetchError) throw error;
        throw new FetchError(controller.signal.aborted ? 'TIMEOUT' : 'FETCH_FAILED');
      }
      return { finalUrl: url.toString(), contentType: type, charset, body };
    }
  } finally {
    clearTimeout(timer);
  }
}
