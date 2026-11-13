import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import type { ExportResult } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import * as Sentry from '@sentry/nextjs';
import { type ServerTelemetryEnv, tracesSampleRatio } from './env';
import { TraceParentOnlyPropagator } from './propagation';
import { publicEntrySampler } from './sampling';
import { scrubSpan } from './scrub';
import { SERVICE_NAME } from './sentry-client-options';
import { buildServerSentryOptions } from './sentry-server-options';
import { sanitizeError } from './server-stack';

/** OBS-22 : tout span passe par `scrub` avant de quitter le processus. */
class ScrubbingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.inner.export(spans.map(scrubSpan), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

const EXPORT_TIMEOUT_MS = 5000;

let started = false;
let sentryStarted = false;

/** React marque ainsi les rendus suspendus ; Next ne les tient pas pour des erreurs. */
function isPostpone(reason: unknown): boolean {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    (reason as { $$typeof?: unknown }).$$typeof === Symbol.for('react.postpone')
  );
}

/** OBS-45 : le SDK ne reçoit qu'une copie nettoyée de l'erreur. */
export function reportServerError(error: unknown, tags: Record<string, string> = {}): void {
  if (!sentryStarted) return;
  try {
    Sentry.captureException(sanitizeError(error), { tags });
  } catch {
    // Le signalement ne fait jamais échouer le serveur (OBS-14).
  }
}

/**
 * Démarre Sentry (erreurs) et OpenTelemetry (traces) dans le processus Node du serveur Next.
 * Appelé par `register()` de `src/instrumentation.ts`, une seule fois. Next produit lui-même ses
 * spans (requêtes, rendus, `fetch`) dès qu'un fournisseur est enregistré : pas d'instrumentation
 * automatique en plus.
 */
export function startServerTelemetry(env: ServerTelemetryEnv): void {
  if (started) return;
  started = true;

  if (env.SENTRY_DSN) {
    Sentry.init(buildServerSentryOptions({ ...env, SENTRY_DSN: env.SENTRY_DSN }));
    sentryStarted = true;
    // Next installe déjà ses propres gestionnaires (le processus ne s'arrête pas) ; on ajoute
    // seulement le signalement, en copie nettoyée. Next écrit cependant l'erreur brute dans
    // ses journaux : voir les suites de la tâche 5 dans `docs/roadmap.md`.
    process.on('uncaughtException', (error) => {
      reportServerError(error);
    });
    process.on('unhandledRejection', (reason) => {
      if (!isPostpone(reason)) reportServerError(reason);
    });
  }

  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, '');
  if (!endpoint) return;

  // Pas de `NodeSDK` : il charge l'exporteur gRPC, que webpack ne sait pas empaqueter, et des
  // détecteurs de ressource (OBS-29 : ligne de commande, nom de machine). La ressource ne porte
  // que ce que nous déclarons.
  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      'service.name': SERVICE_NAME,
      'service.version': env.RELEASE ?? 'dev',
      'deployment.environment.name': env.DEPLOY_ENVIRONMENT,
    }),
    sampler: publicEntrySampler(tracesSampleRatio(env)),
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new ScrubbingSpanExporter(
          new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, timeoutMillis: EXPORT_TIMEOUT_MS }),
        ),
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        exportTimeoutMillis: EXPORT_TIMEOUT_MS,
      }),
    ],
  });
  // Pas de métriques ni de journaux OTLP pour le web à ce stade. Next produit ses spans
  // (requêtes, rendus, `fetch`) dès qu'un fournisseur est enregistré.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  // `traceparent` seulement : ni `tracestate` ni `baggage` du client (voir `propagation.ts`).
  propagation.setGlobalPropagator(new TraceParentOnlyPropagator());
  trace.setGlobalTracerProvider(provider);
}
