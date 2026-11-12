import type { Instrumentation } from 'next';

/**
 * Télémétrie du serveur Next (OBS-03, OBS-04). Rien dans le runtime Edge (middleware) : ni
 * Sentry ni OpenTelemetry n'y sont démarrés. Sans variables, rien n'est initialisé (OBS-14).
 *
 * Les imports restent dans `if (process.env.NEXT_RUNTIME === 'nodejs')` : Next remplace la
 * variable au build, et le compilateur Edge élimine la branche avec ses modules Node.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const [{ parseServerTelemetryEnv }, { startServerTelemetry }] = await Promise.all([
      import('./lib/telemetry/env'),
      import('./lib/telemetry/server'),
    ]);
    startServerTelemetry(parseServerTelemetryEnv(process.env));
  }
}

/**
 * Erreurs de rendu, de route et d'action côté serveur. Pas `Sentry.captureRequestError` : il
 * transmet l'erreur d'origine et le chemin résolu. On envoie une copie nettoyée (OBS-45) avec le
 * gabarit de route (OBS-21), jamais `request.path` ni ses en-têtes.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { reportServerError } = await import('./lib/telemetry/server');
    const tags: Record<string, string> = { 'http.request.method': request.method };
    if (/^\/[\w\-./[\]()@]{0,200}$/.test(context.routePath)) tags['http.route'] = context.routePath;
    reportServerError(error, tags);
  }
};
