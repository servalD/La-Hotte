// Chargé par Next avant l'hydratation (Next 15.3+). Erreurs du navigateur seulement (OBS-03,
// OBS-04), par le relais `/monitoring` (OBS-33). Sans DSN, rien n'est initialisé (OBS-14).
// Les variables sont validées au build (`next.config.ts`) ; ici, une valeur invalide désactive
// le SDK sans jamais empêcher l'application de démarrer.
import * as Sentry from '@sentry/nextjs';
import { browserTelemetryEnv } from './lib/telemetry/env';
import { buildClientSentryOptions } from './lib/telemetry/sentry-client-options';

try {
  const env = browserTelemetryEnv();
  if (env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init(
      buildClientSentryOptions({ ...env, NEXT_PUBLIC_SENTRY_DSN: env.NEXT_PUBLIC_SENTRY_DSN }),
    );
  }
} catch {
  // Télémétrie désactivée.
}
