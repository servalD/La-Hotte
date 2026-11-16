/**
 * Refus et échecs du fetcher, par code stable. Le message ne contient jamais l'URL ni un contenu
 * de page (invariant 7) : l'API ne relaie que le code.
 */
export type FetchErrorCode =
  | 'URL_REFUSED' // EXT-40, EXT-41 : schéma, port, identifiants, adresse non publique
  | 'TOO_MANY_REDIRECTS' // EXT-42
  | 'TIMEOUT' // EXT-43
  | 'TOO_LARGE' // EXT-43
  | 'BAD_TYPE' // EXT-43 : type de contenu inattendu
  | 'UPSTREAM_STATUS' // le site répond une erreur (403 des robots, 404…)
  | 'FETCH_FAILED' // réseau, TLS, DNS
  | 'IMAGE_REJECTED'; // EXT-45 : format refusé (SVG…) ou image illisible

export class FetchError extends Error {
  constructor(readonly code: FetchErrorCode) {
    super(code);
    this.name = 'FetchError';
  }
}
