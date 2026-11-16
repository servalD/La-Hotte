import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { isPublicAddress } from '../src/net/address-policy.js';
import { FetchError } from '../src/net/errors.js';
import {
  checkUrl,
  type FetchLimits,
  type NetworkPolicy,
  safeFetch,
} from '../src/net/safe-fetch.js';

// EXT-40 à EXT-43, critères de 02. Un serveur local joue le site marchand ; la politique de test
// fait résoudre des noms vers lui. Pour prouver qu'un refus vient AVANT toute connexion, le
// serveur compte les requêtes reçues.

let server: Server;
let port: number;
let hits = 0;
let handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.end();

beforeAll(async () => {
  server = createServer((req, res) => {
    hits += 1;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

beforeEach(() => {
  hits = 0;
});

const HTML: FetchLimits = {
  maxBytes: 1024,
  deadlineMs: 2000,
  accepts: (type) => type === 'text/html',
  accept: 'text/html',
};

/**
 * Noms de test : `shop.test` est le serveur local (seule adresse non publique permise, et seulement
 * sur son port) ; les autres pointent vers des adresses interdites.
 */
function policy(): NetworkPolicy {
  const names: Record<string, string[]> = {
    'shop.test': ['127.0.0.1'],
    'metadata.test': ['169.254.169.254'],
    'mixed.test': ['93.184.215.14', '10.0.0.1'],
    'rebind.test': ['127.0.0.1'],
  };
  return {
    ports: new Set([80, 443, port]),
    resolve(hostname) {
      return Promise.resolve(names[hostname] ?? []);
    },
    allows(address, p) {
      if (address === '127.0.0.1' && p === port) return true;
      return this.ports.has(p) && isPublicAddress(address);
    },
  };
}

const shop = (path = '/') => `http://shop.test:${port}${path}`;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    if (error instanceof FetchError) return error.code;
    throw error;
  }
}

describe('EXT-40 : schéma, port, identifiants', () => {
  it.each([
    'ftp://shop.test/',
    'file:///etc/passwd',
    'gopher://shop.test/',
    'javascript:alert(1)',
    'http://user:pass@shop.test/',
    'http://shop.test:8080/',
    'http://shop.test:22/',
    'pas une url',
  ])('refuse %s', (url) => {
    expect(() => checkUrl(url)).toThrow(FetchError);
  });

  it('accepte http et https sur 80 et 443', () => {
    expect(checkUrl('https://shop.example/p?x=1').toString()).toBe('https://shop.example/p?x=1');
    expect(checkUrl('http://shop.example:443/').port).toBe('443');
  });
});

describe('EXT-41 : adresse vérifiée avant toute connexion (critère de 02)', () => {
  it.each([
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://10.0.0.1/',
    'http://2130706433/', // 127.0.0.1 en décimal, normalisé par l'analyseur d'URL
    'http://0x7f.0.0.1/',
    'http://metadata.test/',
    'http://mixed.test/', // une seule adresse privée suffit à refuser le nom
  ])('refuse %s', async (url) => {
    expect(await codeOf(safeFetch(url, HTML, policy()))).toBe('URL_REFUSED');
    expect(hits).toBe(0);
  });

  it('avec la politique de production, le serveur local lui-même est refusé', async () => {
    expect(await codeOf(safeFetch(`http://127.0.0.1:${port}/`, HTML))).toBe('URL_REFUSED');
    expect(hits).toBe(0);
  });

  it('nom inconnu : échec réseau, sans connexion', async () => {
    expect(await codeOf(safeFetch('http://nowhere.test/', HTML, policy()))).toBe('FETCH_FAILED');
  });
});

describe('EXT-42 : redirections revérifiées', () => {
  it('redirection vers une adresse privée refusée avant de la suivre', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    };
    expect(await codeOf(safeFetch(shop(), HTML, policy()))).toBe('URL_REFUSED');
    expect(hits).toBe(1);
  });

  it('redirection vers un nom qui se résout en adresse interdite refusée', async () => {
    handler = (_req, res) => {
      res.writeHead(301, { Location: 'http://metadata.test/' });
      res.end();
    };
    expect(await codeOf(safeFetch(shop(), HTML, policy()))).toBe('URL_REFUSED');
  });

  it('trois redirections au plus', async () => {
    handler = (req, res) => {
      const n = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('n') ?? 0);
      res.writeHead(302, { Location: `/?n=${n + 1}` });
      res.end();
    };
    expect(await codeOf(safeFetch(shop(), HTML, policy()))).toBe('TOO_MANY_REDIRECTS');
    expect(hits).toBe(4);
  });

  it('suit une redirection permise et rend l’URL finale', async () => {
    handler = (req, res) => {
      if (req.url === '/') {
        res.writeHead(302, { Location: '/produit' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Vélo</h1>');
    };
    const fetched = await safeFetch(shop(), HTML, policy());
    expect(fetched.finalUrl).toBe(shop('/produit'));
    expect(fetched.body.toString('utf8')).toBe('<h1>Vélo</h1>');
    expect(fetched.charset).toBe('utf-8');
  });
});

describe('EXT-43 : délai, taille, type', () => {
  it('délai dépassé', async () => {
    handler = () => {
      // Ne répond jamais.
    };
    expect(await codeOf(safeFetch(shop(), { ...HTML, deadlineMs: 200 }, policy()))).toBe('TIMEOUT');
  });

  it('taille annoncée ou réelle dépassée, décompression comprise', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('x'.repeat(2000));
    };
    expect(await codeOf(safeFetch(shop(), HTML, policy()))).toBe('TOO_LARGE');
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
      res.end(gzipSync(Buffer.alloc(100_000, 0x61))); // quelques centaines d'octets compressés
    };
    expect(await codeOf(safeFetch(shop(), HTML, policy()))).toBe('TOO_LARGE');
  });

  it('type de contenu inattendu', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    };
    expect(await codeOf(safeFetch(shop(), HTML, policy()))).toBe('BAD_TYPE');
  });

  it('erreur du site (robots refusés)', async () => {
    handler = (_req, res) => {
      res.writeHead(403);
      res.end();
    };
    expect(await codeOf(safeFetch(shop(), HTML, policy()))).toBe('UPSTREAM_STATUS');
  });
});
