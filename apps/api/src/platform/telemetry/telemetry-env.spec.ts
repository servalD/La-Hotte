import { parseTelemetryEnv, tracesSampleRatio } from './telemetry-env';

describe('variables de télémétrie (OBS-13 à OBS-15)', () => {
  it('OBS-14 : désactivée par défaut, variables vides comprises', () => {
    const env = parseTelemetryEnv({ SENTRY_DSN: '', OTEL_EXPORTER_OTLP_ENDPOINT: '' });
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(env.DEPLOY_ENVIRONMENT).toBe('development');
  });

  it('OBS-15 : 100 % hors production, 10 % en production, réglable', () => {
    expect(tracesSampleRatio(parseTelemetryEnv({ DEPLOY_ENVIRONMENT: 'preview' }))).toBe(1);
    expect(tracesSampleRatio(parseTelemetryEnv({ DEPLOY_ENVIRONMENT: 'production' }))).toBe(0.1);
    expect(
      tracesSampleRatio(
        parseTelemetryEnv({ DEPLOY_ENVIRONMENT: 'production', TRACES_SAMPLE_RATIO: '0.5' }),
      ),
    ).toBe(0.5);
  });

  it('SEC-21 : nomme la variable fautive, jamais sa valeur', () => {
    const secret = 'pas-une-url-secrete';
    expect(() => parseTelemetryEnv({ SENTRY_DSN: secret, RELEASE: 'main' })).toThrow(
      /SENTRY_DSN, RELEASE$/,
    );
    try {
      parseTelemetryEnv({ SENTRY_DSN: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
