import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import {
  type Fetched,
  type FetchedPage,
  type FetchFailure,
  PageFetcher,
  type StoredReadyImage,
} from '../domain/page-fetcher.port';

const FAILURES = new Set<FetchFailure>([
  'URL_REFUSED',
  'TOO_MANY_REDIRECTS',
  'TIMEOUT',
  'TOO_LARGE',
  'BAD_TYPE',
  'UPSTREAM_STATUS',
  'FETCH_FAILED',
  'IMAGE_REJECTED',
]);
/** Au-delà du délai du fetcher (EXT-43 : 10 s) pour lui laisser répondre `TIMEOUT` lui-même. */
const CALL_TIMEOUT_MS = 15_000;

/** Client du service `fetcher` (EXT-44, EXT-46), joint par jeton partagé. */
@Injectable()
export class HttpPageFetcher extends PageFetcher {
  private readonly base: string | null;
  private readonly token: string | null;

  constructor(config: AppConfig) {
    super();
    this.base = config.env.FETCHER_URL?.replace(/\/$/, '') ?? null;
    this.token = config.env.FETCHER_TOKEN ?? null;
  }

  fetchPage(url: string): Promise<Fetched<FetchedPage>> {
    return this.call('/v1/page', JSON.stringify({ url }), 'application/json', (body) => {
      const page = body as { finalUrl?: unknown; html?: unknown };
      if (typeof page.finalUrl !== 'string' || typeof page.html !== 'string') return null;
      return { finalUrl: page.finalUrl, html: page.html };
    });
  }

  fetchImage(url: string): Promise<Fetched<StoredReadyImage>> {
    return this.call('/v1/image', JSON.stringify({ url }), 'application/json', image);
  }

  reencode(bytes: Buffer): Promise<Fetched<StoredReadyImage>> {
    return this.call('/v1/reencode', bytes, 'application/octet-stream', image);
  }

  private async call<T>(
    path: string,
    body: string | Buffer,
    contentType: string,
    parse: (json: unknown) => T | null,
  ): Promise<Fetched<T>> {
    if (!this.base || !this.token) return { ok: false, failure: 'UNAVAILABLE' };
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': contentType },
        body,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      return { ok: false, failure: 'UNAVAILABLE' };
    }
    const json: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const parsed = parse(json);
      return parsed ? { ok: true, ...parsed } : { ok: false, failure: 'UNAVAILABLE' };
    }
    const code = (json as { code?: unknown } | null)?.code;
    const failure =
      typeof code === 'string' && FAILURES.has(code as FetchFailure)
        ? (code as FetchFailure)
        : 'UNAVAILABLE';
    return { ok: false, failure };
  }
}

function image(json: unknown): StoredReadyImage | null {
  const body = json as { contentType?: unknown; data?: unknown };
  if (body.contentType !== 'image/webp' || typeof body.data !== 'string') return null;
  return { contentType: 'image/webp', bytes: Buffer.from(body.data, 'base64') };
}
