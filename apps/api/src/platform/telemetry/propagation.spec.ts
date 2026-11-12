import {
  ROOT_CONTEXT,
  defaultTextMapGetter,
  defaultTextMapSetter,
  trace,
} from '@opentelemetry/api';
import { TraceParentOnlyPropagator } from './propagation';

const MARKER = 'marqueur-velo-rouge';
const TRACE_ID = 'a'.repeat(32);
const SPAN_ID = 'b'.repeat(16);

describe('TraceParentOnlyPropagator (OBS-29)', () => {
  const propagator = new TraceParentOnlyPropagator();
  const incoming = {
    traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`,
    tracestate: `client=${MARKER}`,
    baggage: `panier=${MARKER}`,
  };

  it('garde le contexte de trace du client, retire son tracestate', () => {
    const context = propagator.extract(ROOT_CONTEXT, incoming, defaultTextMapGetter);
    expect(trace.getSpanContext(context)).toStrictEqual({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1,
      isRemote: true,
    });
  });

  it('ne réinjecte rien du client dans une requête sortante', () => {
    const context = propagator.extract(ROOT_CONTEXT, incoming, defaultTextMapGetter);
    const outgoing: Record<string, string> = {};
    propagator.inject(context, outgoing, defaultTextMapSetter);
    expect(outgoing).toStrictEqual({ traceparent: `00-${TRACE_ID}-${SPAN_ID}-01` });
  });

  it('ne déclare que traceparent', () => {
    expect(propagator.fields()).toEqual(['traceparent']);
  });
});
