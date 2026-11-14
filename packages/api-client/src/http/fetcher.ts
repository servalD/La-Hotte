// Écrit à la main : transport HTTP utilisé par tout le code généré (mutateur Orval).
// Même origine que l'application web (ADR 0008) ; cookie de session envoyé automatiquement.

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  requestId?: string;
  errors?: { field: string; code: string; message: string }[];
}

/** Erreur d'API : porte le `code` stable (API-14), que l'interface traduit. */
export class ApiError extends Error {
  constructor(
    readonly problem: ProblemDetails,
    /** Attente demandée par `Retry-After`, en secondes (PIN-03, limitation). */
    readonly retryAfter: number | null = null,
  ) {
    super(problem.code);
    this.name = 'ApiError';
  }

  get status(): number {
    return this.problem.status;
  }
}

/** Type d'erreur des hooks générés (convention Orval) : toujours une ApiError. */
export type ErrorType<TProblem> = ApiError & { problem: TProblem };

let baseUrl = '';

/** Préfixe des URL ; vide dans le navigateur (même origine), absolu côté serveur. */
export function setApiBaseUrl(url: string): void {
  baseUrl = url.replace(/\/$/, '');
}

const CSRF_COOKIE = '__Host-lh_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type CsrfSource = () => string | null;

function cookieCsrf(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === CSRF_COOKIE) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

let csrfSource: CsrfSource | null = null;

/** Remplace la lecture du cookie CSRF (tests, rendu serveur). `null` rétablit la lecture du cookie. */
export function setCsrfTokenSource(source: CsrfSource | null): void {
  csrfSource = source;
}

const isProblem = (value: unknown): value is ProblemDetails =>
  typeof value === 'object' && value !== null && 'code' in value && 'status' in value;

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  // API-21 : toute mutation porte le jeton CSRF recopié du cookie et signale une action de
  // l'utilisateur. Une lecture ne pose `X-User-Activity` que si l'appelant le demande (navigation).
  const method = (init.method ?? 'GET').toUpperCase();
  if (!SAFE_METHODS.has(method)) {
    const token = (csrfSource ?? cookieCsrf)();
    if (token) headers.set('X-CSRF-Token', token);
    headers.set('X-User-Activity', '1');
  }
  const response = await fetch(`${baseUrl}${url}`, { ...init, credentials: 'include', headers });

  const text = response.status === 204 ? '' : await response.text();
  const body: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const retry = Number(response.headers.get('Retry-After'));
    throw new ApiError(
      isProblem(body)
        ? body
        : {
            type: 'about:blank',
            title: response.statusText,
            status: response.status,
            code: 'UNEXPECTED_RESPONSE',
          },
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }

  return body as T;
}

export default apiFetch;
