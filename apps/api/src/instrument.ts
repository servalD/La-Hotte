// Chargé avant l'application : `node --enable-source-maps --import ./dist/instrument.js dist/main.js`
// (OBS-12, OBS-32). Rien d'autre ne doit être importé ici : les instrumentations doivent précéder
// le premier chargement de `http`, d'Express, d'ioredis et de Prisma.
import { startTelemetry } from './platform/telemetry/telemetry';
import { parseTelemetryEnv } from './platform/telemetry/telemetry-env';

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de fichier .env : variables fournies par l'environnement d'exécution.
}

// OBS-14 : sans SENTRY_DSN ni OTEL_EXPORTER_OTLP_ENDPOINT, rien n'est initialisé.
startTelemetry(parseTelemetryEnv(process.env));
