import { Injectable } from '@nestjs/common';
import { type Counter, type Histogram, metrics } from '@opentelemetry/api';
import {
  COUNTER_NAMES,
  type CounterName,
  HISTOGRAM_NAMES,
  type HistogramName,
  type MetricAttributes,
  Metrics,
} from '../../shared/domain';
import { portMetricAttributes } from './scrub';
import { SERVICE_NAME } from './sentry-options';

const COUNTERS: ReadonlySet<string> = new Set(COUNTER_NAMES);
const HISTOGRAMS: ReadonlySet<string> = new Set(HISTOGRAM_NAMES);

/**
 * Adaptateur OpenTelemetry du port `Metrics`. Sans SDK démarré (OBS-14), l'API OpenTelemetry
 * renvoie des instruments inertes. Barrières (OBS-02, OBS-20) : ici, nom de la liste fermée du port
 * (un nom hors liste est ignoré, même si un appelant contourne le typage), clé de la liste blanche
 * et forme de la valeur (`portMetricAttributes`) ; dans la vue du SDK, liste blanche des clés pour
 * tous les instruments, y compris ceux des instrumentations automatiques (`telemetry.ts`).
 */
@Injectable()
export class OtelMetrics extends Metrics {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  increment(name: CounterName, attributes?: MetricAttributes): void {
    if (!COUNTERS.has(name)) return;
    let counter = this.counters.get(name);
    if (!counter) {
      counter = metrics.getMeter(SERVICE_NAME).createCounter(name);
      this.counters.set(name, counter);
    }
    counter.add(1, attributes && portMetricAttributes(attributes));
  }

  record(name: HistogramName, value: number, attributes?: MetricAttributes): void {
    if (!HISTOGRAMS.has(name)) return;
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = metrics.getMeter(SERVICE_NAME).createHistogram(name);
      this.histograms.set(name, histogram);
    }
    histogram.record(value, attributes && portMetricAttributes(attributes));
  }
}
