// Fiche article (ART-01 à ART-06, EXT-20). Montants en unités mineures entières (ART-11).

export const PRODUCT_TITLE_MAX = 200;
export const PRODUCT_DESCRIPTION_MAX = 2000;
export const PRODUCT_MERCHANT_MAX = 120;
export const PRODUCT_URL_MAX = 2048;
/** Un milliard d'unités mineures : au-delà, c'est une erreur de saisie. */
export const PRICE_MINOR_MAX = 1_000_000_000_00;
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export type ProductSource = 'LINK' | 'PHOTO' | 'MANUAL';
export type ShareLevel = 'PRIVATE' | 'CIRCLE' | 'GLOBAL';
export type ExtractionStatus = 'NONE' | 'PENDING' | 'DONE' | 'FAILED';

/** Champs saisissables d'une fiche. */
export interface ProductFields {
  readonly title: string;
  readonly description: string;
  readonly unitPriceMinor: number | null;
  readonly currency: string;
  readonly merchant: string | null;
  readonly sourceUrl: string | null;
}

export interface Product extends ProductFields {
  readonly id: string;
  readonly ownerProfileId: string;
  readonly imageKey: string | null;
  readonly imageFromPhoto: boolean;
  readonly normalizedUrl: string | null;
  readonly source: ProductSource;
  readonly shareLevel: ShareLevel;
  readonly extractionStatus: ExtractionStatus;
  readonly uncertainFields: readonly string[];
  readonly extractionTruncated: boolean;
  readonly priceCheckedAt: Date | null;
  readonly createdAt: Date;
  readonly version: number;
}

/** Vrai si l'URL est une adresse web absolue (`http` ou `https`) de longueur raisonnable. */
export function isWebUrl(value: string): boolean {
  if (value.length > PRODUCT_URL_MAX) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Contrôles du domaine (le DTO a déjà borné les longueurs) ; `null` si les champs sont valables. */
export function productFieldsProblem(fields: ProductFields): string | null {
  if (fields.title.trim().length === 0 || fields.title.length > PRODUCT_TITLE_MAX) return 'title';
  if (fields.description.length > PRODUCT_DESCRIPTION_MAX) return 'description';
  if (
    fields.unitPriceMinor !== null &&
    (!Number.isSafeInteger(fields.unitPriceMinor) ||
      fields.unitPriceMinor < 0 ||
      fields.unitPriceMinor > PRICE_MINOR_MAX)
  ) {
    return 'unitPriceMinor';
  }
  if (!CURRENCY_PATTERN.test(fields.currency)) return 'currency';
  if (fields.merchant !== null && fields.merchant.length > PRODUCT_MERCHANT_MAX) return 'merchant';
  if (fields.sourceUrl !== null && !isWebUrl(fields.sourceUrl)) return 'sourceUrl';
  return null;
}

/** ART-04 : copie des champs, sans lien vers l'original ; l'image réencodée est partagée par clé. */
export function copyFields(source: Product): ProductFields & {
  readonly imageKey: string | null;
  readonly imageFromPhoto: boolean;
} {
  return {
    title: source.title,
    description: source.description,
    unitPriceMinor: source.unitPriceMinor,
    currency: source.currency,
    merchant: source.merchant,
    sourceUrl: source.sourceUrl,
    imageKey: source.imageKey,
    imageFromPhoto: source.imageFromPhoto,
  };
}
