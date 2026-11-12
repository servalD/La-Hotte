import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { errorCode, sanitizeError } from './scrub';
import { shutdownTelemetry } from './telemetry';

export interface ErrorContext {
  requestId?: string;
  /** Gabarit de route (`/api/v1/items/:id`), jamais l'URL résolue (OBS-21). */
  route?: string;
  method?: string;
}

/** Signalement des erreurs inattendues (OBS-25). Jeton d'injection, remplaçable en test. */
export abstract class ErrorReporter {
  abstract report(error: unknown, context: ErrorContext): void;
}

/**
 * Vers GlitchTip par le SDK Sentry. Sans DSN, le SDK n'est pas initialisé et l'appel ne fait
 * rien (OBS-14). Le contenu de l'événement est nettoyé par `beforeSend` (`scrub`).
 */
@Injectable()
export class SentryErrorReporter extends ErrorReporter {
  report(error: unknown, context: ErrorContext): void {
    Sentry.withScope((scope) => {
      if (context.requestId) scope.setTag('request_id', context.requestId);
      if (context.route) scope.setTag('http.route', context.route);
      if (context.method) scope.setTag('http.request.method', context.method);
      const code = errorCode(error);
      if (code) scope.setTag('error.code', code);
      // Le SDK ne reçoit qu'une copie sans message ni propriétés (voir `sanitizeError`).
      Sentry.captureException(sanitizeError(error));
    });
  }
}

/** Vide les files de télémétrie à l'arrêt de l'application (`enableShutdownHooks`). */
@Injectable()
export class TelemetryShutdown implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}
