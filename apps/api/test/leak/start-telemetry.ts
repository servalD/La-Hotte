// À importer en premier dans le fichier de test, comme `instrument.ts` en production : les
// instrumentations doivent précéder le chargement de `http`, d'Express et de Prisma (OBS-12).
import { inject } from 'vitest';
import { startTelemetry } from '../../src/platform/telemetry/telemetry';
import { parseTelemetryEnv } from '../../src/platform/telemetry/telemetry-env';
import '../integration/load-env';

const receiverUrl = inject('receiverUrl');
const { host } = new URL(receiverUrl);

/** Variables de télémétrie du test : les vrais exporteurs, vers les faux récepteurs. */
export const leakTelemetryEnv = {
  OTEL_EXPORTER_OTLP_ENDPOINT: receiverUrl,
  SENTRY_DSN: `http://publickey@${host}/1`,
  DEPLOY_ENVIRONMENT: 'preview',
  TRACES_SAMPLE_RATIO: '1',
} as const;

// L'application relit ces variables (`parseEnv`) : mêmes valeurs des deux côtés.
Object.assign(process.env, leakTelemetryEnv);

startTelemetry(parseTelemetryEnv(process.env));
