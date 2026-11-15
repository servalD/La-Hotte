import { DomainError } from '../../../shared/domain';

/** EXT-34 : 30 extractions par profil et par heure, 200 par compte et par jour. */
export class ExtractionRateLimitedError extends DomainError {
  readonly kind = 'rate_limited';
  readonly code = 'EXTRACTION_RATE_LIMITED';
  override readonly retryAfterSeconds = 3600;

  constructor() {
    super(
      'Vous avez ajouté beaucoup d’articles d’un coup. Réessayez plus tard ou saisissez la fiche à la main.',
    );
  }
}

/** EXT-46 : le fetcher ne répond pas ; la saisie à la main reste possible. */
export class FetcherUnavailableError extends DomainError {
  readonly kind = 'unavailable';
  readonly code = 'FETCHER_UNAVAILABLE';
  override readonly retryAfterSeconds = 60;

  constructor() {
    super('L’analyse des images est indisponible pour le moment.');
  }
}

/** EXT-43, EXT-45 : image trop lourde, illisible ou d'un format refusé (SVG). */
export class ImageRejectedError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'IMAGE_REJECTED';

  constructor() {
    super('Cette image ne peut pas être utilisée.');
  }
}

/** EXT-02 : l'URL n'est pas une adresse web. */
export class ProductUrlInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'PRODUCT_URL_INVALID';

  constructor() {
    super('Ce lien n’est pas une adresse web.');
  }
}
