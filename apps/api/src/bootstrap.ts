import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppConfig } from './platform/config/env';

/** Préfixe de toutes les routes du contrat (API-10). */
export const API_PREFIX = 'api/v1';
const HEALTH_ROUTES = ['health/live', 'health/ready'];

export function applyRouting(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX, { exclude: HEALTH_ROUTES });
}

/** Réglages communs au serveur et aux tests de contrat. */
export function configureApp(app: INestApplication): void {
  const { env } = app.get(AppConfig);

  app.useLogger(app.get(Logger));
  applyRouting(app);

  // SEC-13 : l'API ne sert que du JSON, la politique la plus fermée convient.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // SEC-14 : seule l'origine de l'application web, avec identifiants.
  app.enableCors({
    // Une origine étrangère ne reçoit aucun en-tête CORS (pas même l'origine autorisée).
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, origin === env.WEB_ORIGIN);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'If-Match', 'X-Request-Id'],
    exposedHeaders: ['ETag', 'X-Request-Id'],
  });

  app.enableShutdownHooks();
}
