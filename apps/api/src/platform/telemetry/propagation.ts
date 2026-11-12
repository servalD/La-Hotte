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
 * `traceparent` seulement (OBS-29). Le `tracestate` reçu est du texte libre choisi par le
 * client : on le retire dès l'extraction. Sinon les spans enfants en héritent, il sort dans
 * l'export (`scrubSpanContext` le retire aussi, seconde barrière) et il est réinjecté dans les
 * en-têtes des requêtes sortantes vers des tiers (revue de sécurité du 2026-11-12). Pas de
 * `baggage`, qui transporterait des valeurs arbitraires.
 */
export class TraceParentOnlyPropagator implements TextMapPropagator {
  private readonly inner = new W3CTraceContextPropagator();

  inject(context: Context, carrier: unknown, setter: TextMapSetter): void {
    this.inner.inject(context, carrier, setter);
  }

  extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    const extracted = this.inner.extract(context, carrier, getter);
    const remote = trace.getSpanContext(extracted);
    // Rien d'extrait (en-tête absent ou invalide) : le contexte d'entrée est rendu tel quel.
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
