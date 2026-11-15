import { Injectable } from '@nestjs/common';
import { Prisma, type Product as ProductRow } from '@prisma/client';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import type { Product, ProductFields, ShareLevel } from '../domain/product';
import {
  type ExtractionOutcome,
  type NewProduct,
  type ProductPage,
  ProductRepository,
} from '../domain/product.ports';
import { decodeCursor, encodeCursor } from './cursor';

/** ART-11 : les montants sont des `bigint` en base, des entiers sûrs dans le domaine. */
function toMinor(value: bigint | null): number | null {
  return value === null ? null : Number(value);
}

function toBig(value: number | null | undefined): bigint | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : BigInt(value);
}

export function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    // Une fiche sans propriétaire (PRO-06) n'est jamais lue par `findOwned`.
    ownerProfileId: row.ownerProfileId ?? '',
    title: row.title,
    description: row.description,
    unitPriceMinor: toMinor(row.unitPriceMinor),
    currency: row.currency,
    merchant: row.merchant,
    sourceUrl: row.sourceUrl,
    imageKey: row.imageKey,
    imageFromPhoto: row.imageFromPhoto,
    normalizedUrl: row.normalizedUrl,
    source: row.source,
    shareLevel: row.shareLevel,
    extractionStatus: row.extractionStatus,
    uncertainFields: row.uncertainFields,
    extractionTruncated: row.extractionTruncated,
    priceCheckedAt: row.priceCheckedAt,
    createdAt: row.createdAt,
    version: row.version,
  };
}

function fieldData(changes: Partial<ProductFields>): Prisma.ProductUpdateManyMutationInput {
  return {
    ...(changes.title !== undefined ? { title: changes.title } : {}),
    ...(changes.description !== undefined ? { description: changes.description } : {}),
    ...(changes.unitPriceMinor !== undefined
      ? { unitPriceMinor: toBig(changes.unitPriceMinor) ?? null }
      : {}),
    ...(changes.currency !== undefined ? { currency: changes.currency } : {}),
    ...(changes.merchant !== undefined ? { merchant: changes.merchant } : {}),
    ...(changes.sourceUrl !== undefined ? { sourceUrl: changes.sourceUrl } : {}),
  };
}

@Injectable()
export class PrismaProductRepository extends ProductRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(product: NewProduct): Promise<Product> {
    const row = await this.prisma.product.create({
      data: {
        id: product.id,
        ownerProfileId: product.ownerProfileId,
        title: product.title,
        description: product.description,
        unitPriceMinor: toBig(product.unitPriceMinor) ?? null,
        currency: product.currency,
        merchant: product.merchant,
        sourceUrl: product.sourceUrl,
        normalizedUrl: product.normalizedUrl,
        imageKey: product.imageKey,
        imageFromPhoto: product.imageFromPhoto,
        source: product.source,
        extractionStatus: product.extractionStatus,
        extractionStartedAt: product.extractionStartedAt,
      },
    });
    return toProduct(row);
  }

  async findOwned(ownerProfileId: string, productId: string): Promise<Product | null> {
    const row = await this.prisma.product.findFirst({ where: { id: productId, ownerProfileId } });
    return row ? toProduct(row) : null;
  }

  async findById(productId: string): Promise<Product | null> {
    const row = await this.prisma.product.findUnique({ where: { id: productId } });
    return row ? toProduct(row) : null;
  }

  async listOwned(
    ownerProfileId: string,
    cursor: string | null,
    limit: number,
  ): Promise<ProductPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    const rows = await this.prisma.product.findMany({
      where: {
        ownerProfileId,
        ...(after
          ? {
              OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toProduct),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async update(input: {
    ownerProfileId: string;
    productId: string;
    expectedVersion: number;
    changes: Partial<ProductFields>;
  }): Promise<Product | 'missing' | 'version'> {
    const result = await this.prisma.product.updateMany({
      where: {
        id: input.productId,
        ownerProfileId: input.ownerProfileId,
        version: input.expectedVersion,
      },
      data: { ...fieldData(input.changes), version: { increment: 1 } },
    });
    const row = await this.prisma.product.findFirst({
      where: { id: input.productId, ownerProfileId: input.ownerProfileId },
    });
    if (!row) return 'missing';
    return result.count === 0 ? 'version' : toProduct(row);
  }

  async setShareLevel(
    ownerProfileId: string,
    productId: string,
    level: ShareLevel,
  ): Promise<Product | 'missing'> {
    const result = await this.prisma.product.updateMany({
      where: { id: productId, ownerProfileId },
      data: { shareLevel: level, version: { increment: 1 } },
    });
    if (result.count === 0) return 'missing';
    return toProduct(await this.prisma.product.findUniqueOrThrow({ where: { id: productId } }));
  }

  async findShared(input: {
    ownerIds: readonly string[];
    query: string | null;
    limit: number;
  }): Promise<Product[]> {
    if (input.ownerIds.length === 0) return [];
    const owners = [...input.ownerIds];
    if (input.query) {
      // VIS-40 : requête paramétrée, index GIN `product_search_idx` (aucune concaténation).
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM product
        WHERE share_level = 'CIRCLE'
          AND owner_profile_id = ANY(${owners}::uuid[])
          AND to_tsvector('french', title || ' ' || description) @@ plainto_tsquery('french', ${input.query})
        ORDER BY created_at DESC
        LIMIT ${input.limit}`;
      const rows = await this.prisma.product.findMany({
        where: { id: { in: ids.map((row) => row.id) } },
        orderBy: [{ createdAt: 'desc' }],
      });
      return rows.map(toProduct);
    }
    const rows = await this.prisma.product.findMany({
      where: { shareLevel: 'CIRCLE', ownerProfileId: { in: owners } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit,
    });
    return rows.map(toProduct);
  }
  async completeExtraction(productId: string, outcome: ExtractionOutcome): Promise<Product | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id: productId } });
      if (!current || current.extractionStatus !== 'PENDING') return null;
      // EXT-06 : un champ saisi pendant l'extraction (version augmentée) n'est pas écrasé.
      const touched = current.version > 1;
      const fields = touched ? {} : outcome.fields;
      const row = await tx.product.update({
        where: { id: productId },
        data: {
          ...fieldData(fields),
          ...(outcome.imageKey && !current.imageKey ? { imageKey: outcome.imageKey } : {}),
          extractionStatus: outcome.status,
          uncertainFields: touched ? [] : [...outcome.uncertainFields],
          extractionTruncated: outcome.truncated,
          priceCheckedAt: outcome.priceCheckedAt,
          version: { increment: 1 },
        },
      });
      return toProduct(row);
    });
  }

  async failStaleExtractions(before: Date): Promise<number> {
    const result = await this.prisma.product.updateMany({
      where: { extractionStatus: 'PENDING', extractionStartedAt: { lt: before } },
      data: { extractionStatus: 'FAILED', version: { increment: 1 } },
    });
    return result.count;
  }

  async countExtractionsSince(input: {
    profileId: string;
    accountId: string;
    profileSince: Date;
    accountSince: Date;
  }): Promise<{ profile: number; account: number }> {
    const [profile, account] = await Promise.all([
      this.prisma.product.count({
        where: {
          ownerProfileId: input.profileId,
          extractionStartedAt: { gte: input.profileSince },
        },
      }),
      this.prisma.product.count({
        where: {
          owner: { accountId: input.accountId },
          extractionStartedAt: { gte: input.accountSince },
        },
      }),
    ]);
    return { profile, account };
  }
}
