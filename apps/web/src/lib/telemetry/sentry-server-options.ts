import { isSpanContextValid, trace } from '@opentelemetry/api';
import * as Sentry from '@sentry/nextjs';
import type { ServerTelemetryEnv } from './env';
import { scrubErrorEvent } from './scrub';
import { CLOSED_DATA_COLLECTION, SERVICE_NAME, type SentryOptions } from './sentry-client-options';
import { isTrustedServerFrame, trustedStack } from './server-stack';

/**
 * Intégrations par défaut conservées sur le serveur Next : même liste blanche que l'API. Sont
 * écartées `Console`, `Http`, `NodeFetch`, `RequestData`, `ContextLines`, `LocalVariablesAsync`,
 * `Context`, `Modules`, `ChildProcess`, `NodeSystemError`, `ProcessSession`, les intégrations de
 * traces, et `OnUncaughtException`/`OnUnhandledRejection` (elles transmettent l'erreur d'origine ;
 * voir `server.ts`).
 */
export const KEPT_SERVER_INTEGRATIONS: ReadonlySet<string> = new Set([
  'EventFilters',
  'FunctionToString',
  'LinkedErrors',
  'Dedupe',
]);

/** OBS-12 : l'événement porte le `trace_id` du span OpenTelemetry actif. */
function withActiveTrace(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const context = trace.getActiveSpan()?.spanContext();
  if (!context || !isSpanContextValid(context)) return event;
  return {
    ...event,
    contexts: {
      ...event.contexts,
      trace: { ...event.contexts?.trace, trace_id: context.traceId, span_id: context.spanId },
    },
  };
}

export function buildServerSentryOptions(
  env: ServerTelemetryEnv & { SENTRY_DSN: string },
): SentryOptions {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.DEPLOY_ENVIRONMENT,
    ...(env.RELEASE ? { release: env.RELEASE } : {}),
    serverName: SERVICE_NAME,
    debug: false,
    dataCollection: CLOSED_DATA_COLLECTION,
    // OBS-12 : Sentry ne crée aucun span ; OpenTelemetry est démarré par nous (`server.ts`).
    enableOpenTelemetrySetup: false,
    integrations: (defaults) => [
      ...defaults.filter((integration) => KEPT_SERVER_INTEGRATIONS.has(integration.name)),
      Sentry.openTelemetryIntegration(),
    ],
    // OBS-45 : l'analyseur ne voit que les cadres de confiance.
    stackParser: (stack, skipFirstLines, framesToPop) =>
      Sentry.defaultStackParser(trustedStack(stack), skipFirstLines, framesToPop),
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    sendClientReports: false,
    beforeSend: (event) => scrubErrorEvent(withActiveTrace(event), isTrustedServerFrame),
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
  };
}
