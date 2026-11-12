import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import pino from 'pino';
import { AppConfig } from '../config/env';
import { activeTraceIds } from '../telemetry/correlation';
import { scrubError } from '../telemetry/scrub';

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Destination des journaux : la sortie standard, comme pino par défaut. Jeton remplaçable en
 * test : le test de non-fuite (OBS-26) y capture les lignes réellement écrites.
 */
export abstract class LogDestination {
  abstract write(line: string): void;
}

/**
 * Sérialiseur `err`. pino-http enveloppe les sérialiseurs d'erreur : il reçoit la copie en objet
 * simple faite par `pino-std-serializers` (message compris), l'erreur d'origine étant dans `raw`.
 * On repart de l'erreur d'origine pour que `scrubError` reconnaisse une `Error`.
 */
export function serializeLoggedError(value: unknown): ReturnType<typeof scrubError> {
  const raw: unknown =
    typeof value === 'object' && value !== null && 'raw' in value ? value.raw : value;
  return scrubError(raw);
}

/**
 * Sérialiseur `req` : identifiant et méthode seulement. Ni chemin résolu ni chaîne de requête
 * (OBS-21) : un segment de chemin peut porter un texte choisi par le client.
 */
export function serializeLoggedRequest(value: { id?: unknown; method?: unknown }): {
  id?: unknown;
  method?: unknown;
} {
  return { id: value.id, method: value.method };
}

/**
 * OBS-21 : gabarit de la route atteinte (`/api/v1/example-items/:id`), posé par Express une fois
 * la route trouvée. pino-http sérialise `req` au début de la requête, avant le routage ; ses
 * `customProps` sont réévaluées à la fin : la ligne de fin de requête porte donc `route`. Sans
 * route trouvée (404), aucun chemin n'est écrit.
 */
export function routeProps(req: object): { route?: string } {
  const route: unknown = (req as { route?: { path?: unknown } }).route?.path;
  return typeof route === 'string' ? { route } : {};
}

/**
 * OBS-01 : journaux JSON, identifiant de requête propagé, `trace_id` et `span_id` quand une
 * trace est active. Aucun contenu (SEC-31, OBS-20) : ni corps, ni en-têtes (cookies,
 * autorisation), ni chemin résolu, ni chaîne de requête, ni message d'erreur (`scrub`).
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      providers: [{ provide: LogDestination, useFactory: () => pino.destination(1) }],
      inject: [AppConfig, LogDestination],
      useFactory: (config: AppConfig, destination: LogDestination) => ({
        pinoHttp: [
          {
            level: config.env.LOG_LEVEL,
            mixin: () => activeTraceIds() ?? {},
            genReqId: (req, res) => {
              const incoming = req.headers[REQUEST_ID_HEADER];
              const id =
                typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
                  ? incoming
                  : randomUUID();
              res.setHeader(REQUEST_ID_HEADER, id);
              return id;
            },
            customProps: routeProps,
            serializers: {
              req: serializeLoggedRequest,
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
              err: serializeLoggedError,
            },
            autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
          },
          destination,
        ],
      }),
    }),
  ],
})
export class LoggingModule {}
