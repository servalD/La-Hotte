import type * as Sentry from '@sentry/nextjs';
import type { BrowserTelemetryEnv } from './env';
import { scrubBrowserEvent } from './scrub';

export type SentryOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type DataCollection = NonNullable<SentryOptions['dataCollection']>;

/** OBS-13 */
export const SERVICE_NAME = 'wishlist-web';

/** OBS-33 : relais de notre origine ; la CSP garde `connect-src 'self'`. */
export const MONITORING_TUNNEL = '/monitoring';

/**
 * OBS-28 : chaque clé fermée explicitement, dans le serveur Next comme dans le navigateur.
 * `Required<>` fait échouer la compilation si une version de Sentry en ajoute une.
 */
export const CLOSED_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
} as const satisfies Required<DataCollection>;

/**
 * Intégrations par défaut conservées dans le navigateur : liste blanche. Sont écartées entre
 * autres `Breadcrumbs` et `Console` (clics, saisies, URL visitées), `HttpContext` (URL de la page,
 * agent, référent), `BrowserSession` (sessions), `BrowserTracing` (OBS-03 : le navigateur ne
 * produit pas de traces), `CultureContext`, `ConversationId`.
 */
export const KEPT_BROWSER_INTEGRATIONS: ReadonlySet<string> = new Set([
  'EventFilters',
  'FunctionToString',
  'BrowserApiErrors',
  'GlobalHandlers',
  'LinkedErrors',
  'Dedupe',
  // Réécrit nos cadres en `app:///_next/static/…`, forme attendue par `scrubBrowserEvent`.
  'NextjsClientStackFrameNormalization',
]);

/** Options du SDK navigateur : erreurs seulement, par le relais, nettoyées avant l'envoi. */
export function buildClientSentryOptions(
  env: BrowserTelemetryEnv & { NEXT_PUBLIC_SENTRY_DSN: string },
): SentryOptions {
  return {
    dsn: env.NEXT_PUBLIC_SENTRY_DSN,
    tunnel: MONITORING_TUNNEL,
    environment: env.NEXT_PUBLIC_DEPLOY_ENVIRONMENT,
    ...(env.NEXT_PUBLIC_RELEASE ? { release: env.NEXT_PUBLIC_RELEASE } : {}),
    debug: false,
    dataCollection: CLOSED_DATA_COLLECTION,
    // Ni traces, ni replay, ni profilage : pas de taux d'échantillonnage.
    integrations: (defaults) =>
      defaults.filter((integration) => KEPT_BROWSER_INTEGRATIONS.has(integration.name)),
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    sendClientReports: false,
    beforeSend: (event) => scrubBrowserEvent(event),
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
  };
}
