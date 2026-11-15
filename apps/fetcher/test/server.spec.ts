import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { createFetcherServer } from '../src/server.js';

// EXT-44 à EXT-46 : le service n'obéit qu'à l'API ; il réencode toute image, refuse le SVG, retire
// les métadonnées (GPS compris) et ne renvoie jamais l'URL dans une erreur.

const TOKEN = 'test-fetcher-token-0123456789abcdef0123';
let server: Server;
let base: string;

beforeAll(async () => {
  server = createFetcherServer({ token: TOKEN });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

const auth = { Authorization: `Bearer ${TOKEN}` };

async function photoWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: '#cc3300' } })
    .jpeg()
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '48/1 51/1 24/1' } })
    .withMetadata()
    .toBuffer();
}

describe('Serveur du fetcher (EXT-44, EXT-46)', () => {
  it('sans le jeton partagé : 401', async () => {
    const res = await fetch(`${base}/v1/page`, { method: 'POST', body: '{"url":"https://x"}' });
    expect(res.status).toBe(401);
    const wrong = await fetch(`${base}/v1/page`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${'x'.repeat(TOKEN.length)}` },
      body: '{}',
    });
    expect(wrong.status).toBe(401);
  });

  it('URL interne : refus par code, sans l’URL dans la réponse', async () => {
    const url = 'http://169.254.169.254/latest/meta-data/iam/marqueur-secret';
    const res = await fetch(`${base}/v1/page`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ url }),
    });
    const text = await res.text();
    expect(res.status).toBe(422);
    expect(JSON.parse(text)).toEqual({ code: 'URL_REFUSED' });
    expect(text).not.toContain('169.254');
    expect(text).not.toContain('marqueur');
  });

  it('EXT-45, EXT-11 : photo réencodée en WebP, sans EXIF ni GPS', async () => {
    const photo = await photoWithGps();
    expect((await sharp(photo).metadata()).exif).toBeDefined();
    const res = await fetch(`${base}/v1/reencode`, { method: 'POST', headers: auth, body: photo });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contentType: string; data: string; width: number };
    expect(body.contentType).toBe('image/webp');
    const out = Buffer.from(body.data, 'base64');
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(body.width).toBe(64);
  });

  it('EXT-45 : SVG, HTML et fichier polyglotte refusés avant décodage', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>');
    const html = Buffer.from('<!doctype html><html></html>');
    // Signature PNG suivie d'autre chose : le décodeur ne confirme pas.
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not really a png at all'),
    ]);
    for (const bytes of [svg, html, fake]) {
      const res = await fetch(`${base}/v1/reencode`, {
        method: 'POST',
        headers: auth,
        body: bytes,
      });
      expect(await res.json()).toEqual({ code: 'IMAGE_REJECTED' });
    }
  });

  it('grande image ramenée à 1600 px au plus', async () => {
    const big = await sharp({
      create: { width: 3200, height: 1000, channels: 3, background: '#003366' },
    })
      .png()
      .toBuffer();
    const res = await fetch(`${base}/v1/reencode`, { method: 'POST', headers: auth, body: big });
    const body = (await res.json()) as { width: number; height: number };
    expect(body).toMatchObject({ width: 1600, height: 500 });
  });
});
