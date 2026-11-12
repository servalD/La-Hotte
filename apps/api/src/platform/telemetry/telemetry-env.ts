import { z } from 'zod';

/** Une variable vide (`SENTRY_DSN=`) vaut une variable absente. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/**
 * Variables de télémétrie (OBS-13 à OBS-15). Toutes facultatives : sans DSN ni point de
 * terminaison, rien n'est initialisé ni envoyé (OBS-14). Lues deux fois : par `instrument.ts`,
 * avant le chargement de l'application, et par la configuration de l'application.
 */
export const telemetryEnvShape = {
  /** Base OTLP/HTTP du collecteur, sans `/v1/traces` (OBS-11). */
  OTEL_EXPORTER_OTLP_ENDPOINT: optional(z.url({ protocol: /^https?$/ })),
  /** DSN du projet GlitchTip (OBS-04). */
  SENTRY_DSN: optional(z.url({ protocol: /^https?$/ })),
  /** OBS-13. Distinct de NODE_ENV : la préproduction tourne en `production`. */
  DEPLOY_ENVIRONMENT: z.enum(['development', 'preview', 'production']).default('development'),
  /** OBS-13 : SHA du commit déployé. */
  RELEASE: optional(z.string().regex(/^[0-9a-f]{7,40}$/)),
  /** OBS-15 : part des traces conservées. Par défaut 1 hors production, 0,1 en production. */
  TRACES_SAMPLE_RATIO: optional(z.coerce.number().min(0).max(1)),
};

const telemetryEnvSchema = z.object(telemetryEnvShape);

export type TelemetryEnv = z.infer<typeof telemetryEnvSchema>;

export function parseTelemetryEnv(source: NodeJS.ProcessEnv): TelemetryEnv {
  const result = telemetryEnvSchema.safeParse(source);
  if (!result.success) {
    // On nomme les variables fautives, jamais leur valeur (un DSN contient une clé).
    const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuration de télémétrie invalide : ${names}`);
  }
  return result.data;
}

export function tracesSampleRatio(env: TelemetryEnv): number {
  return env.TRACES_SAMPLE_RATIO ?? (env.DEPLOY_ENVIRONMENT === 'production' ? 0.1 : 1);
}
