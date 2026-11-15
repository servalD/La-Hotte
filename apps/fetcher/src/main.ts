import { createFetcherServer } from './server.js';

// EXT-44 : en production, le conteneur n'a de sortie que vers Internet (filtrée), aucune route vers
// la base ni le réseau interne ; l'adresse d'écoute est celle du réseau qu'il partage avec l'API.

const token = process.env.FETCHER_TOKEN ?? '';
if (token.length < 32) {
  process.stderr.write('Configuration invalide : FETCHER_TOKEN\n');
  process.exit(1);
}
const port = Number(process.env.FETCHER_PORT ?? 4100);
const host = process.env.FETCHER_HOST ?? '127.0.0.1';

const server = createFetcherServer({ token });
server.requestTimeout = 30_000;
server.listen(port, host, () => {
  process.stdout.write(`fetcher prêt sur ${host}:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
