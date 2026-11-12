import { defineConfig } from 'orval';

// ADR 0009 : openapi.json (émis par l'API) → client typé, hooks TanStack Query, schémas Zod.
export default defineConfig({
  api: {
    input: { target: '../../apps/api/openapi.json' },
    output: {
      mode: 'tags-split',
      target: 'src/generated/endpoints',
      schemas: 'src/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        mutator: { path: 'src/http/fetcher.ts', name: 'apiFetch' },
        // Les hooks renvoient le corps ; une erreur est levée (ApiError), jamais renvoyée.
        fetch: { includeHttpResponseReturnType: false },
        query: { useQuery: true, useSuspenseQuery: false, signal: true },
      },
    },
  },
  zod: {
    input: { target: '../../apps/api/openapi.json' },
    output: {
      mode: 'tags-split',
      target: 'src/generated/zod',
      client: 'zod',
      fileExtension: '.zod.ts',
      clean: true,
    },
  },
});
