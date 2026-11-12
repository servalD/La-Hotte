import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Dépôts, transactions, santé : PostgreSQL et Redis réels (docker compose ou services de CI).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    include: ['test/integration/**/*.int-spec.ts'],
    fileParallelism: false,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    setupFiles: ['test/integration/load-env.ts'],
  },
});
