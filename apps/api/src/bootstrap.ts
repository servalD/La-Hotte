import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppConfig } from './platform/config/env';

/** Préfixe de toutes les routes du contrat (API-10). */
export const API_PREFIX = 'api/v1';
const HEALTH_ROUTES = ['health/live', 'health/ready'];

/**
 * ADR 0013, API-21 : réponses de session, d'authentification, de l'espace Compte et du profil
 * actif jamais mises en cache (ni par le navigateur, ni par un mandataire, ni hors ligne).
 */
const NO_STORE_ROOTS = [
  '/session',
  '/sessions',
  '/auth',
  '/account',
  '/trusted-devices',
  '/profiles/me',
].map((path) => `/${API_PREFIX}${path}`);

/** La racine elle-même ou tout chemin en dessous (`/auth/...`), insensible à la casse. */
export function isNoStorePath(path: string): boolean {
  const lower = path.toLowerCase().replace(/\/+$/, '');
  return NO_STORE_ROOTS.some((root) => lower === root || lower.startsWith(`${root}/`));
}

export function applyRouting(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX, { exclude: HEALTH_ROUTES });
}

/** Réglages communs au serveur et aux tests de contrat. */
export function configureApp(app: INestApplication): void {
  const { env } = app.get(AppConfig);

  app.useLogger(app.get(Logger));
  applyRouting(app);

  // ADR 0013 : nombre de mandataires de confiance ; seule source de l'adresse du client (SEC-30).
  (app as NestExpressApplication).set('trust proxy', env.TRUSTED_PROXY_HOPS);

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

  // SEC-13 : Permissions-Policy (helmet 8 ne la pose pas). L'API n'a besoin d'aucune capacité.
  app.use(
    (
      _req: unknown,
      res: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
      );
      next();
    },
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isNoStorePath(req.path)) res.setHeader('Cache-Control', 'no-store');
    next();
  });

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
    allowedHeaders: [
      'Content-Type',
      'Idempotency-Key',
      'If-Match',
      'X-Request-Id',
      'X-CSRF-Token', // API-21
      'X-User-Activity', // API-21
    ],
    exposedHeaders: ['ETag', 'X-Request-Id'],
  });

  app.enableShutdownHooks();
}
