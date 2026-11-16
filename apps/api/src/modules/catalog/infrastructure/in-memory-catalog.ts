import { randomBytes } from 'node:crypto';
import type { Product, ProductFields, ShareLevel } from '../domain/product';
import {
  type ExtractionOutcome,
  ImageStore,
  type NewProduct,
  type ProductPage,
  ProductRepository,
} from '../domain/product.ports';
import type { ExtractionCandidate } from '../domain/extraction';
import {
  type CachedExtraction,
  ExtractionCache,
  type ExtractionJob,
  ExtractionQueue,
  type ModelOutcome,
  ProductExtractor,
} from '../domain/extraction.ports';
import {
  type Fetched,
  type FetchedPage,
  type FetchFailure,
  PageFetcher,
  type StoredReadyImage,
} from '../domain/page-fetcher.port';
import { decodeCursor, encodeCursor } from './cursor';

/** Double de test (ports en mémoire) ; `rows` est partagé avec le double des listes. */
export class InMemoryProductRepository extends ProductRepository {
  readonly rows = new Map<string, Product & { extractionStartedAt: Date | null }>();
  private tick = 0;

  private stamp(): Date {
    this.tick += 1;
    return new Date(Date.UTC(2026, 10, 1) + this.tick);
  }

  create(product: NewProduct): Promise<Product> {
    const row = {
      ...product,
      shareLevel: 'PRIVATE' as const,
      uncertainFields: [],
      extractionTruncated: false,
      priceCheckedAt: null,
      createdAt: this.stamp(),
      version: 1,
    };
    this.rows.set(product.id, row);
    return Promise.resolve(row);
  }

  findOwned(ownerProfileId: string, productId: string): Promise<Product | null> {
    const row = this.rows.get(productId);
    return Promise.resolve(row && row.ownerProfileId === ownerProfileId ? row : null);
  }

  findById(productId: string): Promise<Product | null> {
    return Promise.resolve(this.rows.get(productId) ?? null);
  }

  listOwned(ownerProfileId: string, cursor: string | null, limit: number): Promise<ProductPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    const sorted = [...this.rows.values()]
      .filter((row) => row.ownerProfileId === ownerProfileId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .filter(
        (row) =>
          !after ||
          row.createdAt < after.at ||
          (row.createdAt.getTime() === after.at.getTime() && row.id < after.id),
      );
    const page = sorted.slice(0, limit);
    const last = page[page.length - 1];
    return Promise.resolve({
      items: page,
      nextCursor: sorted.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    });
  }

  update(input: {
    ownerProfileId: string;
    productId: string;
    expectedVersion: number;
    changes: Partial<ProductFields>;
  }): Promise<Product | 'missing' | 'version'> {
    const row = this.rows.get(input.productId);
    if (!row || row.ownerProfileId !== input.ownerProfileId) return Promise.resolve('missing');
    if (row.version !== input.expectedVersion) return Promise.resolve('version');
    const next = { ...row, ...input.changes, version: row.version + 1 };
    this.rows.set(row.id, next);
    return Promise.resolve(next);
  }

  setShareLevel(
    ownerProfileId: string,
    productId: string,
    level: ShareLevel,
  ): Promise<Product | 'missing'> {
    const row = this.rows.get(productId);
    if (!row || row.ownerProfileId !== ownerProfileId) return Promise.resolve('missing');
    const next = { ...row, shareLevel: level, version: row.version + 1 };
    this.rows.set(productId, next);
    return Promise.resolve(next);
  }

  findShared(input: {
    ownerIds: readonly string[];
    query: string | null;
    limit: number;
  }): Promise<Product[]> {
    const words = (input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return Promise.resolve(
      [...this.rows.values()]
        .filter(
          (row) =>
            row.shareLevel === 'CIRCLE' &&
            input.ownerIds.includes(row.ownerProfileId) &&
            words.every((word) => `${row.title} ${row.description}`.toLowerCase().includes(word)),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, input.limit),
    );
  }
  completeExtraction(productId: string, outcome: ExtractionOutcome): Promise<Product | null> {
    const row = this.rows.get(productId);
    if (!row || row.extractionStatus !== 'PENDING') return Promise.resolve(null);
    const touched = row.version > 1;
    const next = {
      ...row,
      ...(touched ? {} : outcome.fields),
      imageKey: row.imageKey ?? outcome.imageKey,
      extractionStatus: outcome.status,
      uncertainFields: touched ? [] : [...outcome.uncertainFields],
      extractionTruncated: outcome.truncated,
      priceCheckedAt: outcome.priceCheckedAt,
      version: row.version + 1,
    };
    this.rows.set(productId, next);
    return Promise.resolve(next);
  }

  failStaleExtractions(before: Date): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (
        row.extractionStatus === 'PENDING' &&
        row.extractionStartedAt &&
        row.extractionStartedAt < before
      ) {
        this.rows.set(row.id, { ...row, extractionStatus: 'FAILED', version: row.version + 1 });
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  /** Compte d'un profil, fourni par le banc de test (identité en mémoire). */
  accountOf: (profileId: string) => string | undefined = () => undefined;

  countExtractionsSince(input: {
    profileId: string;
    accountId: string;
    profileSince: Date;
    accountSince: Date;
  }): Promise<{ profile: number; account: number }> {
    const rows = [...this.rows.values()].filter((row) => row.extractionStartedAt !== null);
    return Promise.resolve({
      profile: rows.filter(
        (row) =>
          row.ownerProfileId === input.profileId &&
          (row.extractionStartedAt ?? new Date(0)) >= input.profileSince,
      ).length,
      account: rows.filter(
        (row) =>
          this.accountOf(row.ownerProfileId) === input.accountId &&
          (row.extractionStartedAt ?? new Date(0)) >= input.accountSince,
      ).length,
    });
  }
}
export class InMemoryImageStore extends ImageStore {
  readonly images = new Map<string, { bytes: Buffer; contentType: string }>();

  put(bytes: Buffer, contentType: string): Promise<string> {
    const key = randomBytes(16).toString('hex');
    this.images.set(key, { bytes, contentType });
    return Promise.resolve(key);
  }

  get(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    return Promise.resolve(this.images.get(key) ?? null);
  }
}

/** Double du `fetcher` : pages et images déclarées par les tests, refus par code sinon. */
export class FakePageFetcher extends PageFetcher {
  readonly pages = new Map<string, FetchedPage | FetchFailure>();
  readonly images = new Map<string, FetchFailure | Buffer>();
  readonly calls: string[] = [];
  available = true;

  fetchPage(url: string): Promise<Fetched<FetchedPage>> {
    this.calls.push(`page:${url}`);
    if (!this.available) return Promise.resolve({ ok: false, failure: 'UNAVAILABLE' });
    const page = this.pages.get(url) ?? 'FETCH_FAILED';
    return Promise.resolve(
      typeof page === 'string' ? { ok: false, failure: page } : { ok: true, ...page },
    );
  }

  fetchImage(url: string): Promise<Fetched<StoredReadyImage>> {
    this.calls.push(`image:${url}`);
    if (!this.available) return Promise.resolve({ ok: false, failure: 'UNAVAILABLE' });
    const image = this.images.get(url) ?? 'FETCH_FAILED';
    return Promise.resolve(
      typeof image === 'string'
        ? { ok: false, failure: image }
        : { ok: true, contentType: 'image/webp', bytes: image },
    );
  }

  reencode(bytes: Buffer): Promise<Fetched<StoredReadyImage>> {
    this.calls.push('reencode');
    if (!this.available) return Promise.resolve({ ok: false, failure: 'UNAVAILABLE' });
    if (bytes.toString('latin1', 0, 4) === '<svg') {
      return Promise.resolve({ ok: false, failure: 'IMAGE_REJECTED' });
    }
    return Promise.resolve({
      ok: true,
      contentType: 'image/webp',
      bytes: Buffer.from('RIFFxxxxWEBP'),
    });
  }
}

/** Double du modèle : réponses déclarées par les tests ; garde le texte reçu (EXT-33). */
export class FakeProductExtractor extends ProductExtractor {
  readonly received: string[] = [];
  photos = 0;
  next: ModelOutcome = { status: 'unavailable' };

  fromPageText(text: string): Promise<ModelOutcome> {
    this.received.push(text);
    return Promise.resolve(this.next);
  }

  fromPhoto(): Promise<ModelOutcome> {
    this.photos += 1;
    return Promise.resolve(this.next);
  }

  static answer(candidate: Partial<ExtractionCandidate>): ModelOutcome {
    return {
      status: 'ok',
      usage: { inputTokens: 1000, outputTokens: 100 },
      candidate: {
        title: null,
        description: null,
        price: null,
        currency: null,
        merchant: null,
        imageUrl: null,
        lowConfidence: [],
        ...candidate,
      },
    };
  }
}

export class InMemoryExtractionCache extends ExtractionCache {
  readonly entries = new Map<string, { value: CachedExtraction; expiresAt: Date }>();

  get(normalizedUrl: string, now: Date): Promise<CachedExtraction | null> {
    const entry = this.entries.get(normalizedUrl);
    return Promise.resolve(entry && entry.expiresAt > now ? entry.value : null);
  }

  put(input: { normalizedUrl: string; value: CachedExtraction; expiresAt: Date }): Promise<void> {
    this.entries.set(input.normalizedUrl, { value: input.value, expiresAt: input.expiresAt });
    return Promise.resolve();
  }
}

/** File manuelle : les tests déclenchent les extractions par `drain(run)`. */
export class ManualExtractionQueue extends ExtractionQueue {
  readonly jobs: ExtractionJob[] = [];

  enqueue(job: ExtractionJob): void {
    this.jobs.push(job);
  }

  async drain(run: {
    link(productId: string, url: string): Promise<void>;
    photo(productId: string, imageKey: string): Promise<void>;
  }): Promise<void> {
    while (this.jobs.length > 0) {
      const job = this.jobs.shift();
      if (!job) break;
      if (job.kind === 'link') await run.link(job.productId, job.url);
      else await run.photo(job.productId, job.imageKey);
    }
  }
}
