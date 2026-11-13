import type { CookieOptions, Request, Response } from 'express';

/** Cookies de session (ADR 0013). Préfixe `__Host-` : `Secure`, `Path=/`, sans `Domain`. */
export const SESSION_COOKIE = '__Host-lh_session';
export const CSRF_COOKIE = '__Host-lh_csrf';
export const PRESESSION_COOKIE = '__Host-lh_presession';
export const UNLOCK_COOKIE = '__Host-lh_unlock';

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

export function setCsrfCookie(response: Response, csrfToken: string): void {
  response.cookie(CSRF_COOKIE, csrfToken, { ...HOST_COOKIE, httpOnly: false });
}

/** ADR 0013 : la pré-session disparaît à l'ouverture d'une session. */
export function clearPresessionCookie(response: Response): void {
  response.clearCookie(PRESESSION_COOKIE, { ...HOST_COOKIE, httpOnly: true });
}

export function clearSessionCookies(response: Response): void {
  response.clearCookie(SESSION_COOKIE, { ...HOST_COOKIE, httpOnly: true });
  response.clearCookie(UNLOCK_COOKIE, { ...HOST_COOKIE, httpOnly: true });
}
