import * as Sentry from '@sentry/nestjs';
import { withActiveTrace } from './correlation';
import { scrubErrorEvent, trustedStack } from './scrub';
import type { TelemetryEnv } from './telemetry-env';

export type SentryOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type DataCollection = NonNullable<SentryOptions['dataCollection']>;

export const SERVICE_NAME = 'wishlist-api';

/**
 * OBS-28 : Sentry 11 collecte tout par défaut. Chaque clé est fermée explicitement ;
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
 * Intégrations par défaut conservées : liste blanche. Sont écartées entre autres `Console` et
 * `ChildProcess` (fils d'Ariane), `Http` et `NodeFetch` (URL complète), `RequestData` (requête),
 * `LocalVariablesAsync`, `ContextLines`, `Context`, `Modules`, `NodeSystemError` (chemins),
 * `ProcessSession`, et les intégrations de traces (`Express`, `Nest`…) : OpenTelemetry possède
 * les spans (OBS-12). `OnUncaughtException` et `OnUnhandledRejection` sont écartées aussi : elles
 * transmettent l'erreur d'origine au SDK et peuvent l'écrire brute sur la sortie d'erreur. Les
 * erreurs fatales passent par `installFatalHandlers` (`fatal.ts`).
 */
export const KEPT_DEFAULT_INTEGRATIONS: ReadonlySet<string> = new Set([
  'EventFilters',
  'FunctionToString',
  'LinkedErrors',
  'Dedupe',
]);

export function buildSentryOptions(env: TelemetryEnv & { SENTRY_DSN: string }): SentryOptions {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.DEPLOY_ENVIRONMENT,
    ...(env.RELEASE ? { release: env.RELEASE } : {}),
    serverName: SERVICE_NAME,
    // Sinon `SENTRY_DEBUG` posée dans l'environnement active les journaux de débogage du SDK.
    debug: false,
    dataCollection: CLOSED_DATA_COLLECTION,
    // OBS-12 : Sentry ne crée aucun span. Pas de `tracesSampleRate`.
    enableOpenTelemetrySetup: false,
    integrations: (defaults) => [
      ...defaults.filter((integration) => KEPT_DEFAULT_INTEGRATIONS.has(integration.name)),
      Sentry.openTelemetryIntegration(),
    ],
    // OBS-45 : le SDK ne reçoit que des erreurs nettoyées (`sanitizeError`) ; par précaution,
    // l'analyseur ne voit en plus que les cadres de confiance, jamais les lignes d'un message.
    stackParser: (stack, skipFirstLines, framesToPop) =>
      Sentry.defaultStackParser(trustedStack(stack), skipFirstLines, framesToPop),
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    sendClientReports: false,
    beforeSend: (event) => scrubErrorEvent(withActiveTrace(event)),
    // Flux non utilisés, fermés quand même : rien d'autre que des erreurs ne part vers GlitchTip.
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
  };
}
