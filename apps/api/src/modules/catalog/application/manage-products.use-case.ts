import { Injectable } from '@nestjs/common';
import { IdGenerator, PlatformSettings } from '../../../shared/domain';
import {
  type GlobalEntry,
  type Publisher,
  PublisherPolicy,
  statusOnPublish,
} from '../domain/moderation';
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
    private readonly settings: PlatformSettings,
    private readonly publishers: PublisherPolicy,
  ) {}

  /**
   * REP-02, REP-08, MOD-06 : le droit (REP-06, MOD-12) est vérifié par l'appelant ; le statut de
   * modération suit le niveau. Publier au catalogue global calcule le statut (MOD-09), une fiche
   * retirée par la modération n'y revient que par la file, et la quitter efface le statut sauf un
   * retrait.
   */
  async setShareLevel(
    ownerProfileId: string,
    productId: string,
    level: ShareLevel,
  ): Promise<Product> {
    const product = await this.products.findOwned(ownerProfileId, productId);
    if (!product) throw new ProductNotFoundError();
    const current = product.moderationStatus;
    const { forbidden_terms, blocked_domains } = this.settings.current();
    const moderation =
      level !== 'GLOBAL'
        ? current === 'REJECTED'
          ? 'REJECTED'
          : 'NONE'
        : product.shareLevel === 'GLOBAL' && current !== 'NONE'
          ? current
          : current === 'REJECTED'
            ? 'PENDING'
            : statusOnPublish(product, {
                forbiddenTerms: forbidden_terms,
                blockedDomains: blocked_domains,
              });
    const result = await this.products.setShareLevel(ownerProfileId, productId, level, moderation);
    if (result === 'missing') throw new ProductNotFoundError();
    return result;
  }

  /** MOD-12 : candidates du catalogue global ; `visibility` tranche fiche par fiche (REP-10). */
  findGlobal(input: {
    readonly query: string | null;
    readonly limit: number;
  }): Promise<GlobalEntry[]> {
    return this.products.findGlobal(input);
  }

  /** MOD-12 : profil enfant, publication suspendue. */
  publisher(profileId: string): Promise<Publisher | null> {
    return this.publishers.of(profileId);
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
  async copy(
    sourceProductId: string,
    newOwnerProfileId: string,
    options: { readonly withoutUserPhoto?: boolean } = {},
  ): Promise<Product> {
    const source = await this.products.findById(sourceProductId);
    if (!source) throw new ProductNotFoundError();
    const fields = copyFields(source);
    // REP-04, RGPD-07 : une photo prise par l'auteur ne sort jamais du catalogue global.
    const image =
      options.withoutUserPhoto && fields.imageFromPhoto
        ? { imageKey: null, imageFromPhoto: false }
        : {};
    return this.products.create({
      ...fields,
      ...image,
      id: this.ids.next(),
      ownerProfileId: newOwnerProfileId,
      source: source.source,
      normalizedUrl: source.normalizedUrl,
      extractionStatus: 'NONE',
      extractionStartedAt: null,
    });
  }
}
