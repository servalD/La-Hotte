import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { parseBrowserTelemetryEnv } from './src/lib/telemetry/env';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// OBS-47 : les variables du navigateur sont inscrites dans le bundle ; une valeur invalide fait
// échouer le build en nommant la variable, jamais sa valeur.
parseBrowserTelemetryEnv(process.env);

// En développement, l'API tourne à part ; en production, Caddy sert web et API sur la même
// origine (ADR 0008). La réécriture reproduit cette même origine en local.
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

/** SEC-13 : en-têtes statiques. La CSP, qui porte un nonce par requête, est posée par le middleware. */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Le lint tourne à part (pnpm lint), avec la configuration partagée.
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@wishlist/api-client'],
  // OBS-30, OBS-31 : cartes du navigateur seulement pour le build de déploiement, qui les envoie à
  // GlitchTip puis les retire (ops/observability/bundle-sourcemaps.mjs) avant que quoi que ce soit
  // ne soit servi. Partout ailleurs (développement, CI des demandes de fusion), aucune carte.
  productionBrowserSourceMaps: process.env.BROWSER_SOURCEMAPS === 'true',
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
  rewrites() {
    return Promise.resolve([{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }]);
  },
};

export default withNextIntl(config);
