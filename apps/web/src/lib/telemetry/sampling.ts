// Copie de apps/api/src/platform/telemetry/sampling.ts (même règle pour le serveur Next, OBS-48).
import type { Context, SpanKind } from '@opentelemetry/api';
import {
  ParentBasedSampler,
  type Sampler,
  SamplingDecision,
  type SamplingResult,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace';

/**
 * Tirage au hasard, indépendant de l'identifiant de trace. Pour un parent distant : l'identifiant
 * vient du `traceparent` du client, qui peut le choisir pour tomber sous le seuil de
 * `TraceIdRatioBasedSampler` et faire tracer chacune de ses requêtes.
 */
export class RandomRatioSampler implements Sampler {
  constructor(
    private readonly ratio: number,
    private readonly random: () => number = Math.random,
  ) {}

  shouldSample(
    _context: Context,
    _traceId: string,
    _name: string,
    _kind: SpanKind,
  ): SamplingResult {
    return {
      decision:
        this.random() < this.ratio
          ? SamplingDecision.RECORD_AND_SAMPLED
          : SamplingDecision.NOT_RECORD,
    };
  }

  toString(): string {
    return `RandomRatioSampler{${this.ratio}}`;
  }
}

/**
 * OBS-15, OBS-29 : la décision d'échantillonnage d'un parent distant n'est pas respectée. Le
 * `traceparent` d'une requête entrante vient d'internet : son drapeau « échantillonné » forcerait
 * l'enregistrement de chaque requête d'un tiers (volume, files bornées saturées, traces légitimes
 * perdues), et son absence ferait échapper ses requêtes aux traces. On garde l'identifiant de
 * trace (corrélation) mais on décide nous-mêmes, au même taux que pour une racine. Un parent local
 * (span du même processus) reste suivi, pour qu'une trace ne soit jamais coupée en deux.
 *
 * Conséquence acceptée : un appel interne entre nos services (serveur Next vers API) est
 * échantillonné indépendamment de chaque côté ; à 100 % (préproduction) rien ne change.
 */
export function publicEntrySampler(ratio: number, random?: () => number): Sampler {
  const remote = new RandomRatioSampler(ratio, random);
  return new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(ratio),
    remoteParentSampled: remote,
    remoteParentNotSampled: remote,
  });
}
