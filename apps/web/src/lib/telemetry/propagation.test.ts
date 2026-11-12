// @vitest-environment node
import { context, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { TraceParentOnlyPropagator } from './propagation';

const MARKER = 'MARQUEUR-VELO-MARIE';
const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

const getter = {
  keys: (carrier: Record<string, string>) => Object.keys(carrier),
  get: (carrier: Record<string, string>, key: string) => carrier[key],
};
const setter = {
  set: (carrier: Record<string, string>, key: string, value: string) => {
    carrier[key] = value;
  },
};

describe('propagation : traceparent seulement (OBS-29)', () => {
  const propagator = new TraceParentOnlyPropagator();

  it('écarte le tracestate du client à l’extraction, et ne le réinjecte pas', () => {
    const incoming = {
      traceparent: TRACEPARENT,
      tracestate: `k=${MARKER}`,
      baggage: `x=${MARKER}`,
      'sentry-trace': `0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-1`,
    };
    const extracted = propagator.extract(ROOT_CONTEXT, incoming, getter);
    const remote = trace.getSpanContext(extracted);
    expect(remote?.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(remote?.traceState).toBeUndefined();

    const outgoing: Record<string, string> = {};
    propagator.inject(extracted, outgoing, setter);
    expect(Object.keys(outgoing)).toEqual(['traceparent']);
    expect(JSON.stringify(outgoing)).not.toContain(MARKER);
  });

  it('sans en-tête, rend le contexte tel quel', () => {
    const active = context.active();
    expect(propagator.extract(active, {}, getter)).toBe(active);
    expect(propagator.fields()).toEqual(['traceparent']);
  });
});
