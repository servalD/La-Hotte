import { Injectable } from '@nestjs/common';
import { type Counter, type Histogram, metrics } from '@opentelemetry/api';
import { type MetricAttributes, Metrics } from '../../shared/domain';
import { SERVICE_NAME } from './sentry-options';

/**
 * Adaptateur OpenTelemetry du port `Metrics`. Sans SDK démarré (OBS-14), l'API OpenTelemetry
 * renvoie des instruments inertes. Les étiquettes passent par `scrub` dans la vue du SDK.
 */
@Injectable()
export class OtelMetrics extends Metrics {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  increment(name: string, attributes?: MetricAttributes): void {
    let counter = this.counters.get(name);
    if (!counter) {
      counter = metrics.getMeter(SERVICE_NAME).createCounter(name);
      this.counters.set(name, counter);
    }
    counter.add(1, attributes);
  }

  record(name: string, value: number, attributes?: MetricAttributes): void {
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = metrics.getMeter(SERVICE_NAME).createHistogram(name);
      this.histograms.set(name, histogram);
    }
    histogram.record(value, attributes);
  }
}
