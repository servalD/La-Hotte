import { Injectable } from '@nestjs/common';
import {
  type GlobalEntry,
  type Product,
  ProductCatalog,
  ProductNotFoundError,
  type ShareLevel,
} from '../../catalog';
import { ProductReferences } from '../../lists';
import {
  globalProductVisible,
  requiresHiddenItemChoice,
  sharedProductVisible,
  VisibilityService,
} from '../../visibility';
import {
  ChildPublicationForbiddenError,
  DirectoryEntryNotFoundError,
  HiddenItemRequiresChoiceError,
  PublicationSuspendedError,
} from '../domain/directory.errors';

export const DIRECTORY_PAGE_MAX = 50;

/** PUT /products/{id}/share (REP-02, REP-06, REP-08, MOD-06, MOD-12). */
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
    if (input.level === 'GLOBAL' && product.shareLevel !== 'GLOBAL') {
      // MOD-12 : ni profil enfant, ni compte dont la publication est suspendue.
      const publisher = await this.catalog.publisher(input.viewerId);
      if (!publisher || publisher.isChild) throw new ChildPublicationForbiddenError();
      if (publisher.publicationSuspended) throw new PublicationSuspendedError();
    }
    if (input.level !== 'PRIVATE') {
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

/** MOD-12, REP-10 : entrées du catalogue global que `visibility` laisse voir à ce profil. */
async function visibleGlobal(
  references: ProductReferences,
  viewerId: string,
  entries: readonly GlobalEntry[],
): Promise<GlobalEntry[]> {
  const refs = await references.of(entries.map((entry) => entry.product.id));
  return entries.filter(({ product }) =>
    globalProductVisible({
      viewerId,
      ownerId: product.ownerProfileId || null,
      shareLevel: product.shareLevel,
      moderationStatus: product.moderationStatus,
      references: refs.get(product.id) ?? [],
    }),
  );
}

/** GET /directory?scope=global&q= (MOD-05, MOD-12, REP-04, REP-10, VIS-40). */
@Injectable()
export class SearchGlobalCatalog {
  constructor(
    private readonly catalog: ProductCatalog,
    private readonly references: ProductReferences,
  ) {}

  async execute(input: {
    viewerId: string;
    query: string | null;
    limit: number;
  }): Promise<GlobalEntry[]> {
    const limit = Math.min(Math.max(input.limit, 1), DIRECTORY_PAGE_MAX);
    const candidates = await this.catalog.findGlobal({
      query: input.query?.trim() || null,
      limit: limit * 2,
    });
    return (await visibleGlobal(this.references, input.viewerId, candidates)).slice(0, limit);
  }
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

/**
 * MOD-07 : une fiche se signale seulement si ce profil la voit dans le répertoire du cercle ou le
 * catalogue global ; sinon `null`, comme une fiche inconnue (SEC-04). Sa propre fiche ne se
 * signale pas.
 */
@Injectable()
export class DirectoryEntryReader {
  constructor(
    private readonly catalog: ProductCatalog,
    private readonly references: ProductReferences,
    private readonly visibility: VisibilityService,
  ) {}

  async readable(
    viewerId: string,
    productId: string,
  ): Promise<{ readonly ownerProfileId: string } | null> {
    const product = await this.catalog.findById(productId);
    if (!product?.ownerProfileId) return null;
    const visible =
      (await visibleEntries(this.visibility, this.references, viewerId, [product])).length > 0 ||
      (await visibleGlobal(this.references, viewerId, [{ product, adopters: 0 }])).length > 0;
    return visible ? { ownerProfileId: product.ownerProfileId } : null;
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
    if (!product) throw new DirectoryEntryNotFoundError();
    const inCircle =
      (await visibleEntries(this.visibility, this.references, input.viewerId, [product])).length >
      0;
    if (inCircle) return this.catalog.copy(product.id, input.viewerId);
    const global = await visibleGlobal(this.references, input.viewerId, [{ product, adopters: 0 }]);
    if (global.length === 0) throw new DirectoryEntryNotFoundError();
    // REP-04 : la photo de l'auteur ne sort pas du catalogue global.
    return this.catalog.copy(product.id, input.viewerId, { withoutUserPhoto: true });
  }
}
