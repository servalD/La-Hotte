import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Env } from '../../../platform/config/env';
import { HttpPageFetcher } from './http-page-fetcher';

// EXT-44, EXT-46 : l'API joint le fetcher par jeton partagé ; un refus arrive par son code, une panne
// ou une réponse inattendue devient `UNAVAILABLE`.

const TOKEN = 'test-fetcher-token-0123456789abcdef';
let server: Server;
let url: string;
let handler: (req: IncomingMessage, res: ServerResponse) => void;
let lastAuth: string | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    lastAuth = req.headers.authorization;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
});

function client(env: Partial<Env>): HttpPageFetcher {
  return new HttpPageFetcher({ env: env as Env });
}

function reply(status: number, body: unknown) {
  return (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}

describe('HttpPageFetcher', () => {
  it('sans configuration : UNAVAILABLE, sans appel', async () => {
    expect(await client({}).fetchPage('https://shop.example/')).toEqual({
      ok: false,
      failure: 'UNAVAILABLE',
    });
  });

  it('page lue, jeton porté', async () => {
    handler = reply(200, { finalUrl: 'https://shop.example/p', html: '<h1>x</h1>' });
    const res = await client({ FETCHER_URL: url, FETCHER_TOKEN: TOKEN }).fetchPage(
      'https://shop.example/',
    );
    expect(res).toEqual({ ok: true, finalUrl: 'https://shop.example/p', html: '<h1>x</h1>' });
    expect(lastAuth).toBe(`Bearer ${TOKEN}`);
  });

  it('refus par code ; code inconnu ou réponse malformée : UNAVAILABLE', async () => {
    const fetcher = client({ FETCHER_URL: url, FETCHER_TOKEN: TOKEN });
    handler = reply(422, { code: 'URL_REFUSED' });
    expect(await fetcher.fetchPage('http://169.254.169.254/')).toEqual({
      ok: false,
      failure: 'URL_REFUSED',
    });
    handler = reply(500, { code: 'WHATEVER' });
    expect(await fetcher.fetchPage('https://x/')).toEqual({ ok: false, failure: 'UNAVAILABLE' });
    handler = reply(200, { html: 42 });
    expect(await fetcher.fetchPage('https://x/')).toEqual({ ok: false, failure: 'UNAVAILABLE' });
  });

  it('image réencodée décodée du base64 ; type autre que WebP refusé', async () => {
    const fetcher = client({ FETCHER_URL: url, FETCHER_TOKEN: TOKEN });
    handler = reply(200, {
      contentType: 'image/webp',
      data: Buffer.from('webp').toString('base64'),
    });
    const ok = await fetcher.reencode(Buffer.from('photo'));
    expect(ok.ok && ok.bytes.toString()).toBe('webp');
    handler = reply(200, { contentType: 'image/svg+xml', data: '' });
    expect(await fetcher.fetchImage('https://x/i.svg')).toEqual({
      ok: false,
      failure: 'UNAVAILABLE',
    });
  });
});
