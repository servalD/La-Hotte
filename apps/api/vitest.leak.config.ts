import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// OBS-26 : non-fuite de la télémétrie. PostgreSQL et Redis réels (requêtes Prisma marquées), et
// `dist/instrument.js` pour le processus enfant des erreurs fatales (`pnpm test:leak` construit).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    include: ['test/leak/**/*.leak-spec.ts'],
    globalSetup: ['test/leak/receivers.ts'],
    // Un processus par fichier : la télémétrie démarrée par un fichier ne déborde pas sur l'autre.
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30_000,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'info' },
  },
});
