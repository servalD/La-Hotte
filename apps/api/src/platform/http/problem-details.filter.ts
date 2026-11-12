import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, Metrics } from '../../shared/domain';
import { ErrorReporter } from '../telemetry/error-reporter';
import {
  genericCodeFor,
  PROBLEM_CONTENT_TYPE,
  problem,
  type ProblemDetails,
  STATUS_BY_DOMAIN_KIND,
} from './problem-details';
import { RequestValidationException } from './validation';

/**
 * Toute erreur sort en `application/problem+json` (RFC 9457, API-14).
 * Jamais de trace d'exécution ni de détail interne. OBS-25 : seules les erreurs inattendues (5xx)
 * sont journalisées et signalées à GlitchTip, avec l'identifiant de requête et le gabarit de
 * route ; les erreurs métier sont comptées par `code`. Le contenu est retiré par `scrub`
 * (sérialiseur `err` des journaux, `beforeSend` de Sentry).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  constructor(
    private readonly errorReporter: ErrorReporter,
    private readonly metrics: Metrics,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const rawId: unknown = request.id;
    const response = http.getResponse<Response>();
    const requestId =
      typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : undefined;

    const body = this.toProblem(exception, requestId);
    if (body.status >= 500) {
      this.logger.error({ err: exception }, 'Erreur inattendue');
      this.errorReporter.report(exception, {
        ...(requestId ? { requestId } : {}),
        ...routeOf(request),
        method: request.method,
      });
    } else if (exception instanceof DomainError) {
      this.metrics.increment('wishlist.domain_errors', {
        code: exception.code,
        status: body.status,
      });
    }

    response.status(body.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(body));
  }

  private toProblem(exception: unknown, requestId: string | undefined): ProblemDetails {
    const ctx = requestId ? { requestId } : {};

    if (exception instanceof DomainError) {
      const status = STATUS_BY_DOMAIN_KIND[exception.kind];
      return problem(status, exception.code, { ...ctx, detail: exception.message });
    }
    if (exception instanceof RequestValidationException) {
      return problem(400, 'VALIDATION_FAILED', { ...ctx, errors: exception.fieldErrors });
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return problem(status, genericCodeFor(status), ctx);
    }
    // Erreurs de l'analyseur de corps d'Express (JSON invalide, corps trop volumineux, charset
    // inconnu) : ce sont des erreurs du client, pas des erreurs internes. Elles portent un
    // statut 4xx ; on n'en reprend jamais le message (il peut citer le contenu reçu).
    const clientStatus = clientErrorStatus(exception);
    if (clientStatus !== null) {
      return problem(clientStatus, genericCodeFor(clientStatus), ctx);
    }
    return problem(500, 'INTERNAL_ERROR', ctx);
  }
}

function clientErrorStatus(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const candidate = exception as { status?: unknown; statusCode?: unknown };
  const status = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 499
    ? status
    : null;
}

/**
 * Gabarit de la route atteinte (`/api/v1/items/:id`), jamais l'URL résolue (OBS-21). Seul
 * `route.path` : `baseUrl` est le chemin réellement atteint par un sous-routeur monté.
 */
function routeOf(request: Request): { route?: string } {
  const route: unknown = (request as { route?: { path?: unknown } }).route?.path;
  return typeof route === 'string' ? { route } : {};
}
