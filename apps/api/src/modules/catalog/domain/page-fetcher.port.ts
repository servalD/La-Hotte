/**
 * Codes rendus par le `fetcher` (EXT-40 à EXT-45), plus `UNAVAILABLE` quand il ne répond pas ou
 * n'est pas configuré. Jamais l'URL ni un contenu (invariant 7).
 */
export type FetchFailure =
  | 'URL_REFUSED'
  | 'TOO_MANY_REDIRECTS'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'BAD_TYPE'
  | 'UPSTREAM_STATUS'
  | 'FETCH_FAILED'
  | 'IMAGE_REJECTED'
  | 'UNAVAILABLE';

export type Fetched<T> =
  ({ readonly ok: true } & T) | { readonly ok: false; readonly failure: FetchFailure };

export interface FetchedPage {
  readonly finalUrl: string;
  readonly html: string;
}

export interface StoredReadyImage {
  readonly contentType: 'image/webp';
  readonly bytes: Buffer;
}

/**
 * Toute récupération d'une URL d'utilisateur et tout décodage d'image passent par le service
 * `fetcher`, isolé (EXT-44, EXT-46, apps/api/CLAUDE.md). L'API ne se connecte jamais elle-même à
 * une URL d'utilisateur.
 */
export abstract class PageFetcher {
  abstract fetchPage(url: string): Promise<Fetched<FetchedPage>>;
  /** Image téléchargée puis réencodée par le fetcher (EXT-03, EXT-45). */
  abstract fetchImage(url: string): Promise<Fetched<StoredReadyImage>>;
  /** Photo de l'utilisateur, réencodée sans métadonnées (EXT-11, EXT-46). */
  abstract reencode(bytes: Buffer): Promise<Fetched<StoredReadyImage>>;
}
