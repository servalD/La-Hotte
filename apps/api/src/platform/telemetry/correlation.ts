import { isSpanContextValid, trace } from '@opentelemetry/api';
import type { ErrorEvent } from '@sentry/nestjs';

export interface TraceIds {
  trace_id: string;
  span_id: string;
}

/** Identifiants du span OpenTelemetry actif, s'il y en a un (OBS-01, OBS-12). */
export function activeTraceIds(): TraceIds | undefined {
  const context = trace.getActiveSpan()?.spanContext();
  if (!context || !isSpanContextValid(context)) return undefined;
  return { trace_id: context.traceId, span_id: context.spanId };
}

/**
 * OBS-12 : l'événement d'erreur porte le `trace_id` du span OpenTelemetry actif. Sans cela, le
 * span interne de Sentry l'emporte et l'identifiant ne correspond pas à la trace d'OpenObserve
 * (constaté par l'essai du 2026-11-12).
 */
export function withActiveTrace(event: ErrorEvent): ErrorEvent {
  const ids = activeTraceIds();
  if (!ids) return event;
  return {
    ...event,
    contexts: { ...event.contexts, trace: { ...event.contexts?.trace, ...ids } },
  };
}
