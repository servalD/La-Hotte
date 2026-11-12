import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from '../config/env';
import { activeTraceIds } from '../telemetry/correlation';
import { scrubError } from '../telemetry/scrub';

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

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
 * OBS-01 : journaux JSON, identifiant de requête propagé, `trace_id` et `span_id` quand une
 * trace est active. Aucun contenu (SEC-31, OBS-20) : ni corps, ni en-têtes (cookies,
 * autorisation), ni chaîne de requête, ni message d'erreur (`scrub`).
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
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
          serializers: {
            req: (req: { id: string; method: string; url?: string }) => ({
              id: req.id,
              method: req.method,
              path: req.url?.split('?')[0],
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            err: serializeLoggedError,
          },
          autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
        },
      }),
    }),
  ],
})
export class LoggingModule {}
