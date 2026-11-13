import type { Attributes } from '@opentelemetry/api';
import type { ExportResult } from '@opentelemetry/core';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  createAllowListAttributesProcessor,
  type IAttributesProcessor,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor, type ReadableSpan, type SpanExporter } from '@opentelemetry/sdk-trace';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import * as Sentry from '@sentry/nestjs';
import { installFatalHandlers } from './fatal';
import { TraceParentOnlyPropagator } from './propagation';
import { publicEntrySampler } from './sampling';
import { METRIC_ATTRIBUTE_ALLOW_LIST, scrubAttributes, scrubSpan } from './scrub';
import { buildSentryOptions, SERVICE_NAME } from './sentry-options';
import { type TelemetryEnv, tracesSampleRatio } from './telemetry-env';

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

/** OBS-20 : seconde barrière derrière la liste blanche, mêmes clés interdites que les spans. */
const scrubbingAttributesProcessor: IAttributesProcessor = {
  process: (incoming: Attributes) => scrubAttributes(incoming),
};

function isGlitchTip(
  request: { hostname?: string | null; host?: string | null; port?: string | number | null },
  dsn: string | undefined,
): boolean {
  if (!dsn) return false;
  const target = new URL(dsn);
  const hostname = request.hostname ?? request.host?.split(':')[0];
  const port = String(request.port ?? (target.protocol === 'https:' ? 443 : 80));
  const targetPort = target.port || (target.protocol === 'https:' ? '443' : '80');
  return hostname === target.hostname && port === targetPort;
}

/** OBS-14 : délais courts, file bornée ; ce qui déborde est abandonné sans bloquer. */
const EXPORT_TIMEOUT_MS = 5000;

let sdk: NodeSDK | undefined;
let sentryStarted = false;

/**
 * Démarre Sentry (erreurs) et OpenTelemetry (traces, métriques) selon les variables présentes.
 * Appelé une seule fois, par `instrument.ts`, avant le chargement de l'application : les
 * instrumentations doivent précéder le premier `require` de `http`, d'Express ou de Prisma.
 */
export function startTelemetry(env: TelemetryEnv): void {
  if (env.SENTRY_DSN) {
    Sentry.init(buildSentryOptions({ ...env, SENTRY_DSN: env.SENTRY_DSN }));
    sentryStarted = true;
  }

  // OBS-45 : exceptions et rejets non gérés capturés par nous, en copie nettoyée, et journalisés
  // sans message. Hors développement même sans DSN : une préproduction ou une production mal
  // configurée ne doit pas écrire l'erreur brute dans ses journaux. En développement sans DSN,
  // Node garde son comportement (pile complète) pour le débogage.
  if (env.SENTRY_DSN || env.DEPLOY_ENVIRONMENT !== 'development') {
    // `shutdownTelemetry` vide aussi les spans en attente, dont celui de la requête fautive.
    installFatalHandlers({ flush: shutdownTelemetry });
  }

  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, '');
  if (!endpoint) return;

  sdk = new NodeSDK({
    // OBS-29 : aucune détection automatique (ligne de commande, nom de machine, chemin de
    // l'exécutable). La ressource ne porte que ce que nous déclarons.
    autoDetectResources: false,
    resource: resourceFromAttributes({
      'service.name': SERVICE_NAME,
      'service.version': env.RELEASE ?? 'dev',
      'deployment.environment.name': env.DEPLOY_ENVIRONMENT,
    }),
    // `traceparent` seulement : ni `tracestate` ni `baggage` du client (voir `propagation.ts`).
    textMapPropagator: new TraceParentOnlyPropagator(),
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
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${endpoint}/v1/metrics`,
          timeoutMillis: EXPORT_TIMEOUT_MS,
        }),
        exportIntervalMillis: 60_000,
        exportTimeoutMillis: EXPORT_TIMEOUT_MS,
      }),
    ],
    // OBS-20 : liste blanche des étiquettes pour tout instrument, ceux des instrumentations
    // automatiques compris (voir `METRIC_ATTRIBUTE_ALLOW_LIST`).
    views: [
      {
        instrumentName: '*',
        attributesProcessors: [
          createAllowListAttributesProcessor([...METRIC_ATTRIBUTE_ALLOW_LIST]),
          scrubbingAttributesProcessor,
        ],
      },
    ],
    // Les journaux sortent par pino sur la sortie standard, pas par OTLP.
    logRecordProcessors: [],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => request.url?.startsWith('/health') ?? false,
        // Les envois vers GlitchTip ne sont pas tracés : bruit, et une boucle si GlitchTip échoue.
        ignoreOutgoingRequestHook: (request) => isGlitchTip(request, env.SENTRY_DSN),
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      // OBS-23 : le nom de la commande, jamais ses arguments.
      new IORedisInstrumentation({ dbStatementSerializer: (command) => command }),
      new PrismaInstrumentation(),
    ],
  });
  sdk.start();
}

/** Vide les files au plus vite à l'arrêt, sans retenir le processus au-delà du délai. */
export async function shutdownTelemetry(): Promise<void> {
  await Promise.allSettled([
    sdk?.shutdown(),
    sentryStarted ? Sentry.close(EXPORT_TIMEOUT_MS) : undefined,
  ]);
  sdk = undefined;
  sentryStarted = false;
}
