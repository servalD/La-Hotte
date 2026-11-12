import type { DomainErrorKind } from '../../shared/domain';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  requestId?: string;
  errors?: FieldError[];
}

export const STATUS_BY_DOMAIN_KIND: Record<DomainErrorKind, number> = {
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  precondition_failed: 412,
  business_rule: 422,
  locked: 423,
};

/** Titres génériques par statut ; le `code` porte la précision. */
const TITLES: Record<number, string> = {
  400: 'Requête invalide',
  401: 'Connexion requise',
  403: 'Action interdite',
  404: 'Introuvable',
  405: 'Méthode non permise',
  409: 'Conflit',
  412: 'Version dépassée',
  413: 'Requête trop volumineuse',
  415: 'Type de contenu non pris en charge',
  422: 'Règle non respectée',
  423: 'Profil verrouillé',
  429: 'Trop de requêtes',
  500: 'Erreur interne',
  503: 'Service indisponible',
};

/** Codes génériques quand l'erreur ne vient pas du domaine. */
const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  423: 'PROFILE_LOCKED',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

export function titleFor(status: number): string {
  return TITLES[status] ?? (status >= 500 ? 'Erreur interne' : 'Requête invalide');
}

export function genericCodeFor(status: number): string {
  return CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
}

export function problem(
  status: number,
  code: string,
  extra: Pick<ProblemDetails, 'detail' | 'errors' | 'requestId'> = {},
): ProblemDetails {
  return { type: 'about:blank', title: titleFor(status), status, code, ...extra };
}
