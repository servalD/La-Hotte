import { Injectable } from '@nestjs/common';
import { type Product, ProductCatalog, ProductNotFoundError, type ShareLevel } from '../../catalog';
import { ProductReferences } from '../../lists';
import {
  requiresHiddenItemChoice,
  sharedProductVisible,
  VisibilityService,
} from '../../visibility';
import {
  DirectoryEntryNotFoundError,
  GlobalCatalogUnavailableError,
  HiddenItemRequiresChoiceError,
} from '../domain/directory.errors';

export const DIRECTORY_PAGE_MAX = 50;

/** PUT /products/{id}/share (REP-02, REP-06, REP-08, REP-09). */
@Injectable()
export class ShareProduct {
  constructor(
    private readonly catalog: ProductCatalog,
    private readonly references: ProductReferences,
  ) {}

  async execute(input: {
    viewerId: string;
    productId: string;
    level: ShareLevel;
    hiddenItemChoice: 'MAKE_VISIBLE_TO_ALL' | null;
  }): Promise<Product> {
    const product = await this.catalog.findOwned(input.viewerId, input.productId);
    if (!product) throw new ProductNotFoundError();
    if (input.level === 'GLOBAL') throw new GlobalCatalogUnavailableError();
    if (input.level === 'CIRCLE') {
      const references = (await this.references.of([product.id])).get(product.id) ?? [];
      if (requiresHiddenItemChoice(references)) {
        // REP-06 : seul le premier choix publie ; le second ne passe pas par ici (sélecteur VIS-13).
        if (input.hiddenItemChoice !== 'MAKE_VISIBLE_TO_ALL')
          throw new HiddenItemRequiresChoiceError();
        await this.references.makeVisibleToAll(input.viewerId, product.id);
      }
    }
    return this.catalog.setShareLevel(input.viewerId, product.id, input.level);
  }
}

async function visibleEntries(
  visibility: VisibilityService,
  references: ProductReferences,
  viewerId: string,
  products: readonly Product[],
): Promise<Product[]> {
  const circle = new Set(await visibility.circleOf(viewerId));
  const refs = await references.of(products.map((product) => product.id));
  return products.filter((product) =>
    sharedProductVisible({
      viewerId,
      ownerId: product.ownerProfileId || null,
      shareLevel: product.shareLevel,
      viewerInOwnerCircle: circle.has(product.ownerProfileId),
      references: refs.get(product.id) ?? [],
    }),
  );
}

/** GET /directory?scope=circle&q= (REP-03, REP-07, REP-10, VIS-40). */
@Injectable()
export class SearchDirectory {
  constructor(
    private readonly catalog: ProductCatalog,
    private readonly references: ProductReferences,
    private readonly visibility: VisibilityService,
  ) {}

  async execute(input: {
    viewerId: string;
    query: string | null;
    limit: number;
  }): Promise<Product[]> {
    const circle = await this.visibility.circleOf(input.viewerId);
    const limit = Math.min(Math.max(input.limit, 1), DIRECTORY_PAGE_MAX);
    const candidates = await this.catalog.findShared({
      ownerIds: circle,
      query: input.query?.trim() || null,
      limit: limit * 2,
    });
    return (
      await visibleEntries(this.visibility, this.references, input.viewerId, candidates)
    ).slice(0, limit);
  }
}

/** POST /directory/{productId}/copy : « ajouter à ma liste » commence par une copie (REP-05, ART-04). */
@Injectable()
export class CopyFromDirectory {
  constructor(
    private readonly catalog: ProductCatalog,
    private readonly references: ProductReferences,
    private readonly visibility: VisibilityService,
  ) {}

  async execute(input: { viewerId: string; productId: string }): Promise<Product> {
    const product = await this.catalog.findById(input.productId);
    const visible = product
      ? await visibleEntries(this.visibility, this.references, input.viewerId, [product])
      : [];
    if (!product || visible.length === 0) throw new DirectoryEntryNotFoundError();
    return this.catalog.copy(product.id, input.viewerId);
  }
}
