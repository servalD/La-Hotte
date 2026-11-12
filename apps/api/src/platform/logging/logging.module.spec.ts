import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import pinoHttp from 'pino-http';
import { routeProps, serializeLoggedError, serializeLoggedRequest } from './logging.module';

const MARKER = 'MARQUEUR-JOURNAL';

function capture(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('sérialiseur err à travers pino-http (OBS-01, OBS-45)', () => {
  // Régression du 2026-11-12 : pino-http enveloppe le sérialiseur, qui recevait un objet simple
  // et journalisait `{"type":"object"}`, sans type ni pile.
  it('journalise type, code et cadres de l’erreur d’origine, jamais le message', () => {
    const { stream, lines } = capture();
    const http = pinoHttp({ serializers: { err: serializeLoggedError } }, stream);
    const error = Object.assign(new TypeError(`échec ${MARKER}`), { code: 'P2002' });

    http.logger.error({ err: error }, 'Erreur inattendue');

    const [line] = lines();
    const err = line?.err as { type?: string; code?: string; stack?: string };
    expect(err.type).toBe('TypeError');
    expect(err.code).toBe('P2002');
    expect(err.stack).toMatch(/^\s+at /);
    expect(JSON.stringify(line)).not.toContain(MARKER);
  });
});

describe('journal de requête (OBS-21)', () => {
  const url = `/api/v1/items/${MARKER}?q=${MARKER}`;

  it('req : identifiant et méthode, jamais le chemin résolu ni la chaîne de requête', () => {
    const logged = serializeLoggedRequest(
      Object.assign({ id: 'abc', method: 'GET' }, { url, path: url }),
    );
    expect(logged).toEqual({ id: 'abc', method: 'GET' });
  });

  it('route : le gabarit posé par Express', () => {
    expect(routeProps({ url, route: { path: '/api/v1/items/:id' } })).toEqual({
      route: '/api/v1/items/:id',
    });
  });

  it('sans route trouvée (404), aucun chemin', () => {
    expect(routeProps({ url })).toEqual({});
  });

  it('à travers pino-http : la ligne de fin de requête porte le gabarit', async () => {
    const { stream, lines } = capture();
    const http = pinoHttp(
      { customProps: routeProps, serializers: { req: serializeLoggedRequest } },
      stream,
    );
    const server = createServer((req, res) => {
      http(req, res);
      Object.assign(req, { route: { path: '/api/v1/items/:id' } });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await fetch(`http://127.0.0.1:${port}${url}`);
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    const [line] = lines();
    expect(line?.route).toBe('/api/v1/items/:id');
    expect(JSON.stringify(line)).not.toContain(MARKER);
  });
});
