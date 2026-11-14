import type { CookieOptions, Request, Response } from 'express';

/** Cookies de session (ADR 0013). Préfixe `__Host-` : `Secure`, `Path=/`, sans `Domain`. */
export const SESSION_COOKIE = '__Host-lh_session';
export const CSRF_COOKIE = '__Host-lh_csrf';
export const PRESESSION_COOKIE = '__Host-lh_presession';
export const UNLOCK_COOKIE = '__Host-lh_unlock';
/** ADR 0013 : pré-authentification (mot de passe validé, second facteur attendu). */
export const PENDING_COOKIE = '__Host-lh_pending';
/** AUTH-12, ADR 0013 : appareil de confiance. */
export const DEVICE_COOKIE = '__Host-lh_device';

const PRESESSION_MAX_AGE_MS = 60 * 60 * 1000;

const HOST_COOKIE: CookieOptions = { secure: true, sameSite: 'lax', path: '/' };

/**
 * Lecture d'un cookie dans l'en-tête brut. Sans dépendance : un nom présent deux fois (cookie
 * injecté par un sous-domaine sous un autre nom de chemin) est refusé plutôt que deviné.
 */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return null;
  let found: string | null = null;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0 || pair.slice(0, index).trim() !== name) continue;
    if (found !== null) return null;
    found = pair.slice(index + 1).trim();
  }
  if (found === null) return null;
  try {
    return decodeURIComponent(found);
  } catch {
    return null;
  }
}

/** Jeton de session (`HttpOnly`) et jeton CSRF (lisible par le script). */
export function setSessionCookies(
  response: Response,
  input: { token: string; csrfToken: string; expiresAt: Date },
): void {
  response.cookie(SESSION_COOKIE, input.token, {
    ...HOST_COOKIE,
    httpOnly: true,
    expires: input.expiresAt,
  });
  response.cookie(CSRF_COOKIE, input.csrfToken, { ...HOST_COOKIE, httpOnly: false });
}

export function setPresessionCookies(
  response: Response,
  input: { presessionId: string; csrfToken: string },
): void {
  response.cookie(PRESESSION_COOKIE, input.presessionId, {
    ...HOST_COOKIE,
    httpOnly: true,
    maxAge: PRESESSION_MAX_AGE_MS,
  });
  response.cookie(CSRF_COOKIE, input.csrfToken, { ...HOST_COOKIE, httpOnly: false });
}

/**
 * Pré-session seule, sans toucher au jeton CSRF : départ vers Google depuis un navigateur qui a
 * une session mais pas de pré-session (le jeton CSRF reste celui de la session).
 */
export function setPresessionCookie(response: Response, presessionId: string): void {
  response.cookie(PRESESSION_COOKIE, presessionId, {
    ...HOST_COOKIE,
    httpOnly: true,
    maxAge: PRESESSION_MAX_AGE_MS,
  });
}

export function setCsrfCookie(response: Response, csrfToken: string): void {
  response.cookie(CSRF_COOKIE, csrfToken, { ...HOST_COOKIE, httpOnly: false });
}

/** ADR 0013 : la pré-session disparaît à l'ouverture d'une session. */
export function clearPresessionCookie(response: Response): void {
  response.clearCookie(PRESESSION_COOKIE, { ...HOST_COOKIE, httpOnly: true });
}

/**
 * Pré-authentification : `SameSite=Strict`, elle ne sert qu'à un `POST` de la même origine ; durée
 * de l'état côté serveur (5 minutes).
 */
export function setPendingCookie(response: Response, token: string, maxAgeMs: number): void {
  response.cookie(PENDING_COOKIE, token, {
    ...HOST_COOKIE,
    sameSite: 'strict',
    httpOnly: true,
    maxAge: maxAgeMs,
  });
}

export function clearPendingCookie(response: Response): void {
  response.clearCookie(PENDING_COOKIE, { ...HOST_COOKIE, sameSite: 'strict', httpOnly: true });
}

export function setDeviceCookie(response: Response, token: string, maxAgeMs: number): void {
  response.cookie(DEVICE_COOKIE, token, { ...HOST_COOKIE, httpOnly: true, maxAge: maxAgeMs });
}

export function clearDeviceCookie(response: Response): void {
  response.clearCookie(DEVICE_COOKIE, { ...HOST_COOKIE, httpOnly: true });
}

/**
 * `EVERY_OPEN` (PIN-07, ADR 0013) : nonce de déverrouillage, **sans** `Max-Age` ni `Expires` :
 * le navigateur l'oublie à sa fermeture. `SameSite=Strict` : seuls les appels de l'application,
 * de la même origine, le portent.
 */
export function setUnlockCookie(response: Response, nonce: string): void {
  response.cookie(UNLOCK_COOKIE, nonce, { ...HOST_COOKIE, sameSite: 'strict', httpOnly: true });
}

export function clearUnlockCookie(response: Response): void {
  response.clearCookie(UNLOCK_COOKIE, { ...HOST_COOKIE, sameSite: 'strict', httpOnly: true });
}

export function clearSessionCookies(response: Response): void {
  response.clearCookie(SESSION_COOKIE, { ...HOST_COOKIE, httpOnly: true });
  response.clearCookie(UNLOCK_COOKIE, { ...HOST_COOKIE, httpOnly: true });
}
