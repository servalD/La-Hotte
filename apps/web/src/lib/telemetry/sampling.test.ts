// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type Context,
  context,
  defaultTextMapGetter,
  ROOT_CONTEXT,
  SpanKind,
  TraceFlags,
  trace,
} from '@opentelemetry/api';
import { SamplingDecision, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace';
import { describe, expect, it } from 'vitest';
import { TraceParentOnlyPropagator } from './propagation';
import { publicEntrySampler } from './sampling';

// Identifiant choisi par un tiers pour passer sous n'importe quel seuil de TraceIdRatioBasedSampler.
const CHOSEN_TRACE_ID = '00000000000000000000000000000001';

function withParent(flags: TraceFlags, isRemote: boolean): Context {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: CHOSEN_TRACE_ID,
    spanId: '0000000000000001',
    traceFlags: flags,
    isRemote,
  });
}

/** Décision pour un tirage donné : `random` est injecté, le résultat est exact. */
function decide(ctx: Context, ratio: number, draw: number): SamplingDecision {
  return publicEntrySampler(ratio, () => draw).shouldSample(
    ctx,
    CHOSEN_TRACE_ID,
    'GET /x',
    SpanKind.SERVER,
    {},
    [],
  ).decision;
}

const SAMPLED = SamplingDecision.RECORD_AND_SAMPLED;
const DROPPED = SamplingDecision.NOT_RECORD;

describe('échantillonnage d’une entrée publique (OBS-15, OBS-29)', () => {
  it('l’attaque existe : TraceIdRatioBasedSampler échantillonne toujours cet identifiant', () => {
    const { decision } = new TraceIdRatioBasedSampler(0.01).shouldSample(
      context.active(),
      CHOSEN_TRACE_ID,
    );
    expect(decision).toBe(SAMPLED);
  });

  it('parent distant : le tirage décide, ni le drapeau ni l’identifiant', () => {
    for (const flags of [TraceFlags.SAMPLED, TraceFlags.NONE]) {
      const parent = withParent(flags, true);
      expect(decide(parent, 0.1, 0.09)).toBe(SAMPLED);
      expect(decide(parent, 0.1, 0.11)).toBe(DROPPED);
      expect(decide(parent, 0, 0)).toBe(DROPPED);
      expect(decide(parent, 1, 0.999)).toBe(SAMPLED);
    }
  });

  it('parent local : suivi, une trace n’est jamais coupée', () => {
    expect(decide(withParent(TraceFlags.SAMPLED, false), 0, 0.5)).toBe(SAMPLED);
    expect(decide(withParent(TraceFlags.NONE, false), 1, 0.5)).toBe(DROPPED);
  });

  it('chaîne réelle : un traceparent extrait par notre propagateur est bien un parent distant', () => {
    const extracted = new TraceParentOnlyPropagator().extract(
      ROOT_CONTEXT,
      { traceparent: `00-${CHOSEN_TRACE_ID}-0000000000000001-01`, tracestate: 'k=v' },
      defaultTextMapGetter,
    );
    expect(trace.getSpanContext(extracted)?.isRemote).toBe(true);
    // Drapeau « échantillonné » et identifiant choisi : rejeté à 0 %, sur la seule foi du tirage.
    expect(decide(extracted, 0, 0)).toBe(DROPPED);
    expect(decide(extracted, 0.1, 0.5)).toBe(DROPPED);
  });

  it('tirage par défaut : environ le taux demandé, ni jamais ni toujours', () => {
    const sampler = publicEntrySampler(0.1);
    const parent = withParent(TraceFlags.SAMPLED, true);
    let sampled = 0;
    for (let i = 0; i < 5000; i++) {
      const { decision } = sampler.shouldSample(
        parent,
        CHOSEN_TRACE_ID,
        'x',
        SpanKind.SERVER,
        {},
        [],
      );
      if (decision === SAMPLED) sampled++;
    }
    expect(sampled / 5000).toBeGreaterThan(0.05);
    expect(sampled / 5000).toBeLessThan(0.15);
  });
});

describe('alignement avec l’API', () => {
  it('sampling.ts est la copie exacte de celui de l’API', () => {
    const read = (url: URL) => readFileSync(fileURLToPath(url), 'utf8').replace(/\r\n/g, '\n');
    const api = read(
      new URL('../../../../api/src/platform/telemetry/sampling.ts', import.meta.url),
    );
    const web = read(new URL('./sampling.ts', import.meta.url));
    // Seule la première ligne (provenance) diffère.
    expect(web.split('\n').slice(1).join('\n')).toBe(api);
  });
});
