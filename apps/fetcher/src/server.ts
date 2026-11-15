import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { IMAGE_MAX_BYTES, reencode } from './image/reencode.js';
import { FetchError } from './net/errors.js';
import { type NetworkPolicy, PUBLIC_INTERNET, safeFetch } from './net/safe-fetch.js';

// EXT-44, EXT-46 : service isolé, sans base ni accès au réseau interne. Il n'accepte que les appels
// de l'API (jeton partagé) et ne journalise ni URL ni contenu (invariant 7).

export const PAGE_MAX_BYTES = 5 * 1024 * 1024;
export const DEADLINE_MS = 10_000;
const JSON_MAX_BYTES = 16 * 1024;
const PAGE_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export interface FetcherOptions {
  readonly token: string;
  readonly policy?: NetworkPolicy;
  readonly deadlineMs?: number;
}

const STATUS: Record<FetchError['code'], number> = {
  URL_REFUSED: 422,
  TOO_MANY_REDIRECTS: 422,
  TIMEOUT: 504,
  TOO_LARGE: 413,
  BAD_TYPE: 415,
  UPSTREAM_STATUS: 502,
  FETCH_FAILED: 502,
  IMAGE_REJECTED: 422,
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > max) throw new FetchError('TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? '';
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function urlOf(req: IncomingMessage): Promise<string> {
  const raw = await readBody(req, JSON_MAX_BYTES);
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as { url?: unknown };
    if (typeof parsed.url === 'string' && parsed.url.length <= 2048) return parsed.url;
  } catch {
    // Corps illisible : refus commun.
  }
  throw new FetchError('URL_REFUSED');
}

function decodeText(body: Buffer, charset: string | null): string {
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

export function createFetcherServer(options: FetcherOptions): Server {
  const policy = options.policy ?? PUBLIC_INTERNET;
  const deadlineMs = options.deadlineMs ?? DEADLINE_MS;

  return createServer((req, res) => {
    void (async () => {
      if (req.method === 'GET' && req.url === '/health') {
        send(res, 200, { status: 'up' });
        return;
      }
      if (!authorized(req, options.token)) {
        send(res, 401, { code: 'UNAUTHORIZED' });
        return;
      }
      if (req.method !== 'POST') {
        send(res, 405, { code: 'METHOD_NOT_ALLOWED' });
        return;
      }

      switch (req.url) {
        case '/v1/page': {
          const fetched = await safeFetch(
            await urlOf(req),
            {
              maxBytes: PAGE_MAX_BYTES,
              deadlineMs,
              accepts: (type) => PAGE_TYPES.has(type),
              accept: 'text/html,application/xhtml+xml;q=0.9',
            },
            policy,
          );
          send(res, 200, {
            finalUrl: fetched.finalUrl,
            contentType: fetched.contentType,
            html: decodeText(fetched.body, fetched.charset),
          });
          return;
        }
        case '/v1/image': {
          const fetched = await safeFetch(
            await urlOf(req),
            {
              maxBytes: IMAGE_MAX_BYTES,
              deadlineMs,
              accepts: (type) => IMAGE_TYPES.has(type),
              accept: 'image/avif,image/webp,image/png,image/jpeg;q=0.9',
            },
            policy,
          );
          const image = await reencode(fetched.body);
          send(res, 200, {
            contentType: image.contentType,
            data: image.bytes.toString('base64'),
            width: image.width,
            height: image.height,
          });
          return;
        }
        case '/v1/reencode': {
          const image = await reencode(await readBody(req, IMAGE_MAX_BYTES));
          send(res, 200, {
            contentType: image.contentType,
            data: image.bytes.toString('base64'),
            width: image.width,
            height: image.height,
          });
          return;
        }
        default: {
          send(res, 404, { code: 'NOT_FOUND' });
          return;
        }
      }
    })().catch((error: unknown) => {
      if (res.headersSent) return;
      if (error instanceof FetchError) {
        send(res, STATUS[error.code], { code: error.code });
        return;
      }
      send(res, 500, { code: 'INTERNAL' });
    });
  });
}
