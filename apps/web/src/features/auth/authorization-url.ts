/**
 * URL de départ chez Google rendue par l'API : on ne navigue que vers Google (ou, en développement,
 * vers un fournisseur local), jamais vers une adresse arbitraire.
 */
export function safeAuthorizationUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // Un fournisseur local n'existe qu'en développement et en test.
  const local =
    process.env.NODE_ENV !== 'production' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol === 'https:' && url.hostname === 'accounts.google.com') return url.toString();
  if (local && (url.protocol === 'http:' || url.protocol === 'https:')) return url.toString();
  return null;
}

/** Navigue vers Google ; `false` si l'adresse n'est pas acceptable. */
export function goToAuthorization(value: string): boolean {
  const safe = safeAuthorizationUrl(value);
  if (!safe) return false;
  window.location.assign(safe);
  return true;
}
