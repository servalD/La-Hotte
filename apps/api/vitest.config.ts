import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Domaine, cas d'usage et contrat (application montée, ports en mémoire) : sans base.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'test/contract/**/*.spec.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
      REDIS_URL: 'redis://127.0.0.1:1',
      WEB_ORIGIN: 'http://localhost:3000',
      LOG_LEVEL: 'silent',
      CSRF_SECRET: 'test-csrf-secret-0123456789abcdef',
      KEY_HMAC_SECRET: 'test-key-hmac-secret-0123456789abcdef',
      // « test-only-secret-encryption-key0 » en base64 (SEC-22), refusée en production.
      SECRET_ENCRYPTION_KEYS: '0:dGVzdC1vbmx5LXNlY3JldC1lbmNyeXB0aW9uLWtleTA=',
      REGISTRATION_MODE: 'OPEN',
      SMTP_URL: 'smtp://127.0.0.1:1',
      MAIL_FROM: 'noreply@lahotte.test',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/domain/**', 'src/**/application/**'],
      exclude: ['**/*.spec.ts'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
