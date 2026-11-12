import {
  type Context,
  type SpanContext,
  type TextMapGetter,
  type TextMapPropagator,
  type TextMapSetter,
  trace,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

/**
 * `traceparent` seulement (OBS-29), comme dans l'API (`TraceParentOnlyPropagator`). Next
 * extrait le contexte des requêtes entrantes et l'injecte dans ses `fetch` par le propagateur
 * global : sans ce filtre, le `tracestate` du navigateur serait hérité puis réinjecté.
 */
export class TraceParentOnlyPropagator implements TextMapPropagator {
  private readonly inner = new W3CTraceContextPropagator();

  inject(context: Context, carrier: unknown, setter: TextMapSetter): void {
    this.inner.inject(context, carrier, setter);
  }

  extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    const extracted = this.inner.extract(context, carrier, getter);
    const remote = trace.getSpanContext(extracted);
    if (!remote?.traceState || remote === trace.getSpanContext(context)) return extracted;
    const withoutState: SpanContext = {
      traceId: remote.traceId,
      spanId: remote.spanId,
      traceFlags: remote.traceFlags,
      ...(remote.isRemote !== undefined ? { isRemote: remote.isRemote } : {}),
    };
    return trace.setSpanContext(extracted, withoutState);
  }

  fields(): string[] {
    return ['traceparent'];
  }
}
