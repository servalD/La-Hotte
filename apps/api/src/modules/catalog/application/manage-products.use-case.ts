import { Injectable } from '@nestjs/common';
import { IdGenerator } from '../../../shared/domain';
import {
  copyFields,
  type Product,
  type ProductFields,
  type ShareLevel,
  productFieldsProblem,
} from '../domain/product';
import {
  ImageNotFoundError,
  ProductInvalidError,
  ProductNotFoundError,
  ProductVersionMismatchError,
} from '../domain/product.errors';
import { ImageStore, type ProductPage, ProductRepository } from '../domain/product.ports';

export const PRODUCT_PAGE_MAX = 50;

/** EXT-20 : saisie à la main, seul le titre est obligatoire ; prix absent = prix libre. */
@Injectable()
export class CreateProduct {
  constructor(
    private readonly products: ProductRepository,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: { ownerProfileId: string; fields: ProductFields }): Promise<Product> {
    if (productFieldsProblem(input.fields)) throw new ProductInvalidError();
    return this.products.create({
      ...input.fields,
      title: input.fields.title.trim(),
      id: this.ids.next(),
      ownerProfileId: input.ownerProfileId,
      source: 'MANUAL',
      imageKey: null,
      imageFromPhoto: false,
      normalizedUrl: null,
      extractionStatus: 'NONE',
      extractionStartedAt: null,
    });
  }
}

/** ART-05 : le propriétaire seul. */
@Injectable()
export class GetOwnProduct {
  constructor(private readonly products: ProductRepository) {}

  async execute(input: { ownerProfileId: string; productId: string }): Promise<Product> {
    const product = await this.products.findOwned(input.ownerProfileId, input.productId);
    if (!product) throw new ProductNotFoundError();
    return product;
  }
}

@Injectable()
export class ListOwnProducts {
  constructor(private readonly products: ProductRepository) {}

  execute(input: {
    ownerProfileId: string;
    cursor: string | null;
    limit: number;
  }): Promise<ProductPage> {
    return this.products.listOwned(
      input.ownerProfileId,
      input.cursor,
      Math.min(Math.max(input.limit, 1), PRODUCT_PAGE_MAX),
    );
  }
}

/** ART-03, ART-06 : la modification se voit partout, sauf le prix copié sur les éléments. */
@Injectable()
export class UpdateProduct {
  constructor(private readonly products: ProductRepository) {}

  async execute(input: {
    ownerProfileId: string;
    productId: string;
    expectedVersion: number;
    changes: Partial<ProductFields>;
  }): Promise<Product> {
    const current = await this.products.findOwned(input.ownerProfileId, input.productId);
    if (!current) throw new ProductNotFoundError();
    const changes = {
      ...input.changes,
      ...(input.changes.title !== undefined ? { title: input.changes.title.trim() } : {}),
    };
    if (productFieldsProblem({ ...current, ...changes })) throw new ProductInvalidError();
    const result = await this.products.update({ ...input, changes });
    if (result === 'missing') throw new ProductNotFoundError();
    if (result === 'version') throw new ProductVersionMismatchError();
    return result;
  }
}

/** EXT-47 : servie à tout profil actif qui en connaît la clé. */
@Injectable()
export class GetImage {
  constructor(private readonly images: ImageStore) {}

  async execute(key: string): Promise<{ bytes: Buffer; contentType: string }> {
    const image = /^[0-9a-f]{32}$/.test(key) ? await this.images.get(key) : null;
    if (!image) throw new ImageNotFoundError();
    return image;
  }
}

/**
 * Surface de `catalog` pour les autres modules (`lists`, `directory`). Ne décide d'aucun droit de
 * lecture : l'appelant a vérifié par `visibility` que le profil voit la fiche source (ART-04).
 */
@Injectable()
export class ProductCatalog {
  constructor(
    private readonly products: ProductRepository,
    private readonly ids: IdGenerator,
  ) {}

  /** REP-02, REP-08 : le droit (REP-06, REP-09) est vérifié par l'appelant. */
  async setShareLevel(
    ownerProfileId: string,
    productId: string,
    level: ShareLevel,
  ): Promise<Product> {
    const result = await this.products.setShareLevel(ownerProfileId, productId, level);
    if (result === 'missing') throw new ProductNotFoundError();
    return result;
  }

  /** REP-03, VIS-40 : candidates ; `visibility` tranche fiche par fiche. */
  findShared(input: {
    readonly ownerIds: readonly string[];
    readonly query: string | null;
    readonly limit: number;
  }): Promise<Product[]> {
    return this.products.findShared(input);
  }

  /** Fiche quelconque, pour une décision de `visibility` (répertoire). */
  findById(productId: string): Promise<Product | null> {
    return this.products.findById(productId);
  }

  /** Fiche du profil, ou `null` (ART-05). */
  findOwned(ownerProfileId: string, productId: string): Promise<Product | null> {
    return this.products.findOwned(ownerProfileId, productId);
  }

  /** ART-04, REP-05 : nouvelle fiche au copieur, sans lien vers l'original ni partage. */
  async copy(sourceProductId: string, newOwnerProfileId: string): Promise<Product> {
    const source = await this.products.findById(sourceProductId);
    if (!source) throw new ProductNotFoundError();
    return this.products.create({
      ...copyFields(source),
      id: this.ids.next(),
      ownerProfileId: newOwnerProfileId,
      source: source.source,
      normalizedUrl: source.normalizedUrl,
      extractionStatus: 'NONE',
      extractionStartedAt: null,
    });
  }
}
