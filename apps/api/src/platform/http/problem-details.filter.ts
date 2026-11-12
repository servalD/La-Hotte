import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../../shared/domain';
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
 * Jamais de trace d'exécution ni de détail interne ; les erreurs inattendues sont journalisées
 * côté serveur avec l'identifiant de requête, sans contenu (SEC-31).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const rawId: unknown = http.getRequest<Request & { id?: unknown }>().id;
    const response = http.getResponse<Response>();
    const requestId =
      typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : undefined;

    const body = this.toProblem(exception, requestId);
    if (body.status >= 500) {
      this.logger.error(
        { err: exception instanceof Error ? { name: exception.name, stack: exception.stack } : {} },
        'Erreur inattendue',
      );
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
    return problem(500, 'INTERNAL_ERROR', ctx);
  }
}
