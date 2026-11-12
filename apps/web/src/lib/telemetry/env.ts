import { z } from 'zod';

/** Une variable vide (`SENTRY_DSN=`) vaut une variable absente. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const deployEnvironment = z.enum(['development', 'preview', 'production']);

/**
 * Variables du serveur Next (OBS-47), mêmes noms et mêmes règles que celles de l'API (OBS-46).
 * Toutes facultatives : sans DSN ni point de terminaison, rien n'est initialisé (OBS-14).
 */
const serverTelemetryEnvSchema = z.object({
  /** Base OTLP/HTTP du collecteur, sans `/v1/traces` (OBS-11). */
  OTEL_EXPORTER_OTLP_ENDPOINT: optional(z.url({ protocol: /^https?$/ })),
  /** DSN du projet GlitchTip pour les erreurs du serveur Next (OBS-04). */
  SENTRY_DSN: optional(z.url({ protocol: /^https?$/ })),
  DEPLOY_ENVIRONMENT: deployEnvironment.default('development'),
  RELEASE: optional(z.string().regex(/^[0-9a-f]{7,40}$/)),
  TRACES_SAMPLE_RATIO: optional(z.coerce.number().min(0).max(1)),
});

export type ServerTelemetryEnv = z.infer<typeof serverTelemetryEnvSchema>;

/**
 * Variables du navigateur (OBS-47), inscrites dans le bundle au build par Next : elles doivent
 * être lues par leur nom complet (`process.env.NEXT_PUBLIC_…`) pour être remplacées.
 */
const browserTelemetryEnvSchema = z.object({
  NEXT_PUBLIC_SENTRY_DSN: optional(z.url({ protocol: /^https?$/ })),
  NEXT_PUBLIC_DEPLOY_ENVIRONMENT: deployEnvironment.default('development'),
  NEXT_PUBLIC_RELEASE: optional(z.string().regex(/^[0-9a-f]{7,40}$/)),
});

export type BrowserTelemetryEnv = z.infer<typeof browserTelemetryEnvSchema>;

function parse<T extends z.ZodType>(schema: T, source: Record<string, unknown>): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    // On nomme les variables fautives, jamais leur valeur (un DSN contient une clé).
    const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuration de télémétrie invalide : ${names}`);
  }
  return result.data;
}

export function parseServerTelemetryEnv(source: Record<string, unknown>): ServerTelemetryEnv {
  return parse(serverTelemetryEnvSchema, source);
}

export function parseBrowserTelemetryEnv(source: Record<string, unknown>): BrowserTelemetryEnv {
  return parse(browserTelemetryEnvSchema, source);
}

/** Variables du navigateur, lues par leur nom complet pour que Next les inscrive au build. */
export function browserTelemetryEnv(): BrowserTelemetryEnv {
  return parseBrowserTelemetryEnv({
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_DEPLOY_ENVIRONMENT: process.env.NEXT_PUBLIC_DEPLOY_ENVIRONMENT,
    NEXT_PUBLIC_RELEASE: process.env.NEXT_PUBLIC_RELEASE,
  });
}

export function tracesSampleRatio(env: ServerTelemetryEnv): number {
  return env.TRACES_SAMPLE_RATIO ?? (env.DEPLOY_ENVIRONMENT === 'production' ? 0.1 : 1);
}
