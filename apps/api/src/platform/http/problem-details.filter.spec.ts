import { type ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { type CounterName, DomainError, type MetricAttributes, Metrics } from '../../shared/domain';
import { type ErrorContext, ErrorReporter } from '../telemetry/error-reporter';
import { ProblemDetailsFilter } from './problem-details.filter';

class RecordingReporter extends ErrorReporter {
  readonly reports: { error: unknown; context: ErrorContext }[] = [];
  report(error: unknown, context: ErrorContext): void {
    this.reports.push({ error, context });
  }
}

class RecordingMetrics extends Metrics {
  readonly increments: { name: string; attributes?: MetricAttributes }[] = [];
  increment(name: CounterName, attributes?: MetricAttributes): void {
    this.increments.push({ name, ...(attributes ? { attributes } : {}) });
  }
  record(): void {}
}

class ItemNotFound extends DomainError {
  readonly kind = 'not_found' as const;
  readonly code = 'ITEM_NOT_FOUND';
  constructor() {
    super('Élément introuvable');
  }
}

function hostFor(): { host: ArgumentsHost; status: () => number } {
  let status = 0;
  const response = {
    status(code: number) {
      status = code;
      return response;
    },
    type: () => response,
    send: () => response,
  };
  const request = {
    id: 'req-12345678',
    method: 'POST',
    baseUrl: '',
    route: { path: '/api/v1/items/:id' },
    originalUrl: '/api/v1/items/42?title=secret',
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, status: () => status };
}

describe('ProblemDetailsFilter et télémétrie (OBS-25)', () => {
  let reporter: RecordingReporter;
  let metrics: RecordingMetrics;
  let filter: ProblemDetailsFilter;

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    reporter = new RecordingReporter();
    metrics = new RecordingMetrics();
    filter = new ProblemDetailsFilter(reporter, metrics);
  });

  it('signale une erreur inattendue avec gabarit de route et identifiant de requête', () => {
    const { host, status } = hostFor();
    const error = new Error('boom');
    filter.catch(error, host);

    expect(status()).toBe(500);
    expect(reporter.reports).toEqual([
      {
        error,
        context: { requestId: 'req-12345678', route: '/api/v1/items/:id', method: 'POST' },
      },
    ]);
    expect(JSON.stringify(reporter.reports[0]?.context)).not.toContain('secret');
  });

  it('ne signale pas une erreur métier, la compte par code', () => {
    const { host, status } = hostFor();
    filter.catch(new ItemNotFound(), host);

    expect(status()).toBe(404);
    expect(reporter.reports).toEqual([]);
    expect(metrics.increments).toEqual([
      { name: 'wishlist.domain_errors', attributes: { code: 'ITEM_NOT_FOUND', kind: 'not_found' } },
    ]);
  });

  it('ne signale pas une 4xx de Nest', () => {
    const { host } = hostFor();
    filter.catch(new NotFoundException(), host);
    expect(reporter.reports).toEqual([]);
  });
});
