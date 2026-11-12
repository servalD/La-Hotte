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
  constructor(readonly problem: ProblemDetails) {
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

const isProblem = (value: unknown): value is ProblemDetails =>
  typeof value === 'object' && value !== null && 'code' in value && 'status' in value;

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  const response = await fetch(`${baseUrl}${url}`, { ...init, credentials: 'include', headers });

  const text = response.status === 204 ? '' : await response.text();
  const body: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new ApiError(
      isProblem(body)
        ? body
        : {
            type: 'about:blank',
            title: response.statusText,
            status: response.status,
            code: 'UNEXPECTED_RESPONSE',
          },
    );
  }

  return body as T;
}

export default apiFetch;
