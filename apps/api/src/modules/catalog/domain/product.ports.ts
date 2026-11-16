import type {
  ExtractionStatus,
  Product,
  ProductFields,
  ProductSource,
  ShareLevel,
} from './product';

export interface NewProduct extends ProductFields {
  readonly id: string;
  readonly ownerProfileId: string;
  readonly source: ProductSource;
  readonly imageKey: string | null;
  readonly imageFromPhoto: boolean;
  readonly normalizedUrl: string | null;
  readonly extractionStatus: ExtractionStatus;
  readonly extractionStartedAt: Date | null;
}

export interface ProductPage {
  readonly items: readonly Product[];
  readonly nextCursor: string | null;
}

/** Résultat d'une extraction (EXT-04, EXT-07), appliqué au brouillon encore en `PENDING`. */
export interface ExtractionOutcome {
  readonly status: 'DONE' | 'FAILED';
  readonly fields: Partial<ProductFields>;
  readonly imageKey: string | null;
  readonly uncertainFields: readonly string[];
  readonly truncated: boolean;
  readonly priceCheckedAt: Date | null;
}

export abstract class ProductRepository {
  abstract create(product: NewProduct): Promise<Product>;
  /** ART-05 : `null` si la fiche n'existe pas ou n'est pas à ce profil. */
  abstract findOwned(ownerProfileId: string, productId: string): Promise<Product | null>;
  /** Fiche quelconque, pour une copie dont le droit a été vérifié par `visibility` (ART-04). */
  abstract findById(productId: string): Promise<Product | null>;
  /** Plus récentes d'abord ; curseur opaque. */
  abstract listOwned(
    ownerProfileId: string,
    cursor: string | null,
    limit: number,
  ): Promise<ProductPage>;
  /** API-17 : `version` si la version lue n'est plus la bonne, `missing` si la fiche n'est pas à lui. */
  abstract update(input: {
    readonly ownerProfileId: string;
    readonly productId: string;
    readonly expectedVersion: number;
    readonly changes: Partial<ProductFields>;
  }): Promise<Product | 'missing' | 'version'>;
  /** REP-02, REP-08 : niveau de partage ; missing si la fiche n'est pas à lui. */
  abstract setShareLevel(
    ownerProfileId: string,
    productId: string,
    level: ShareLevel,
  ): Promise<Product | 'missing'>;
  /**
   * REP-03, VIS-40 : fiches publiées au cercle par ces propriétaires, les plus récentes d'abord ;
   * `query` : recherche plein texte (titre et description, dictionnaire français).
   */
  abstract findShared(input: {
    readonly ownerIds: readonly string[];
    readonly query: string | null;
    readonly limit: number;
  }): Promise<Product[]>;
  /** EXT-06 : n'écrit que sur une fiche encore en `PENDING` ; les champs saisis entre-temps restent. */
  abstract completeExtraction(
    productId: string,
    outcome: ExtractionOutcome,
  ): Promise<Product | null>;
  /** EXT-06 : passe en `FAILED` les extractions commencées avant `before`. */
  abstract failStaleExtractions(before: Date): Promise<number>;
  /** EXT-34 : extractions commencées depuis `since`, par le profil et par tout son compte. */
  abstract countExtractionsSince(input: {
    readonly profileId: string;
    readonly accountId: string;
    readonly profileSince: Date;
    readonly accountSince: Date;
  }): Promise<{ readonly profile: number; readonly account: number }>;
}

/** EXT-47, ADR 0016 : images réencodées, sous une clé aléatoire de 128 bits. */
export abstract class ImageStore {
  abstract put(bytes: Buffer, contentType: string): Promise<string>;
  abstract get(key: string): Promise<{ bytes: Buffer; contentType: string } | null>;
}
