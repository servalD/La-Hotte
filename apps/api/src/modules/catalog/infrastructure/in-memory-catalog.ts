import { randomBytes } from 'node:crypto';
import type { Product, ProductFields } from '../domain/product';
import {
  type ExtractionOutcome,
  ImageStore,
  type NewProduct,
  type ProductPage,
  ProductRepository,
} from '../domain/product.ports';
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

  countExtractionsSince(input: { profileIds: readonly string[]; since: Date }): Promise<number> {
    return Promise.resolve(
      [...this.rows.values()].filter(
        (row) =>
          input.profileIds.includes(row.ownerProfileId) &&
          row.extractionStartedAt !== null &&
          row.extractionStartedAt >= input.since,
      ).length,
    );
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
