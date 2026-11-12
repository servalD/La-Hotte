// @vitest-environment node
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { GET, PUT } from '@/app/monitoring/route';
import {
  clientAddress,
  createForward,
  createRelay,
  FixedWindowLimiter,
  type ForwardFn,
  MAX_BODY_BYTES,
  parseDsn,
} from './relay';

const DSN = 'http://cle-publique@glitchtip.interne:8000/3';
const MARKER = 'MARQUEUR-VELO-POUR-MARIE';

function setup(options: { dsn?: string; perClient?: number } = {}) {
  const forward = vi.fn<ForwardFn>().mockResolvedValue({ ok: true });
  const relay = createRelay({
    dsn: parseDsn(options.dsn ?? DSN),
    limiter: new FixedWindowLimiter({
      windowMs: 60_000,
      perClient: options.perClient ?? 100,
      total: 1000,
      maxClients: 100,
    }),
    forward,
  });
  return { relay, forward };
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://hotte.example/monitoring', { method: 'POST', body, headers });
}

function errorEvent(): Record<string, unknown> {
  return {
    event_id: 'a'.repeat(32),
    timestamp: 1_700_000_000,
    platform: 'javascript',
    level: 'error',
    environment: 'preview',
    release: 'abc1234',
    sdk: { name: 'sentry.javascript.nextjs', version: '11.12.0' },
    message: `message ${MARKER}`,
    request: { url: `https://hotte.example/items/1?url=${MARKER}`, headers: { Cookie: MARKER } },
    user: { email: `${MARKER}@example.com` },
    breadcrumbs: [{ message: MARKER }],
    extra: { title: MARKER },
    transaction: `/items/${MARKER}`,
    tags: { 'http.route': '/items/[id]', titre: MARKER },
    exception: {
      values: [
        {
          type: 'TypeError',
          value: `Cannot read ${MARKER}`,
          mechanism: { type: 'onerror', handled: false, data: { message: MARKER } },
          stacktrace: {
            frames: [
              {
                filename: 'app:///_next/static/chunks/app/page-1a2b.js',
                function: 'onClick',
                lineno: 1,
                colno: 2,
                vars: { title: MARKER },
              },
              { filename: `https://evil.example/${MARKER}.js`, function: 'x', lineno: 1, colno: 1 },
              {
                filename: 'app:///_next/static/chunks/a.js',
                function: `${MARKER} reserve`,
                lineno: 1,
              },
              {
                filename: 'app:///_next/static/chunks/b.js?dpl=secret',
                function: 'f',
                lineno: 3,
                pre_context: [MARKER],
              },
            ],
          },
        },
      ],
    },
    contexts: {
      trace: { trace_id: 'b'.repeat(32), span_id: 'c'.repeat(16), data: { url: MARKER } },
      browser: { name: MARKER },
    },
  };
}

function envelope(
  header: Record<string, unknown>,
  items: [Record<string, unknown>, Record<string, unknown> | string][],
): string {
  return [
    JSON.stringify(header),
    ...items.flatMap(([itemHeader, payload]) => [
      JSON.stringify(itemHeader),
      typeof payload === 'string' ? payload : JSON.stringify(payload),
    ]),
  ].join('\n');
}

describe('relais /monitoring (OBS-33)', () => {
  it('transmet un événement à la destination fixe, corps seul, nettoyé', async () => {
    const { relay, forward } = setup();
    const body = envelope(
      {
        dsn: DSN,
        event_id: 'a'.repeat(32),
        sent_at: '2026-11-13T10:00:00.000Z',
        trace: { transaction: `/items/${MARKER}`, public_key: 'cle-publique' },
      },
      [[{ type: 'event' }, errorEvent()]],
    );
    const response = await relay(
      post(body, { Cookie: `session=${MARKER}`, 'X-Forwarded-For': '203.0.113.7' }),
    );

    expect(response.status).toBe(200);
    expect(forward).toHaveBeenCalledTimes(1);
    const [url, sent] = forward.mock.calls[0] ?? [];
    expect(url).toBe('http://glitchtip.interne:8000/api/3/envelope/');
    expect(sent).not.toContain(MARKER);
    expect(sent).not.toContain('203.0.113.7');
    expect(sent).not.toContain('dpl=secret');

    const [header, itemHeader, payload] = (sent ?? '').split('\n');
    expect(JSON.parse(header ?? '')).toEqual({
      dsn: DSN,
      event_id: 'a'.repeat(32),
      sent_at: '2026-11-13T10:00:00.000Z',
    });
    expect(JSON.parse(itemHeader ?? '')).toEqual({ type: 'event' });
    const event = JSON.parse(payload ?? '') as Record<string, unknown>;
    expect(event.tags).toEqual({ 'http.route': '/items/[id]' });
    expect(event.contexts).toEqual({
      trace: { trace_id: 'b'.repeat(32), span_id: 'c'.repeat(16) },
    });
    expect(event.exception).toEqual({
      values: [
        {
          type: 'TypeError',
          mechanism: { type: 'onerror', handled: false },
          stacktrace: {
            frames: [
              {
                filename: 'app:///_next/static/chunks/app/page-1a2b.js',
                function: 'onClick',
                lineno: 1,
                colno: 2,
              },
              { filename: 'app:///_next/static/chunks/b.js', function: 'f', lineno: 3 },
            ],
          },
        },
      ],
    });
  });

  it('lit les éléments à longueur déclarée et abandonne tout ce qui n’est pas une erreur', async () => {
    const { relay, forward } = setup();
    const event = JSON.stringify(errorEvent());
    const body = [
      JSON.stringify({ dsn: DSN }),
      JSON.stringify({ type: 'session' }),
      JSON.stringify({ sid: MARKER }),
      JSON.stringify({ type: 'event', length: Buffer.byteLength(event) }),
      event,
      JSON.stringify({ type: 'client_report' }),
      JSON.stringify({ discarded: MARKER }),
    ].join('\n');

    expect((await relay(post(body))).status).toBe(200);
    const sent = forward.mock.calls[0]?.[1] ?? '';
    expect(sent.split('\n')).toHaveLength(3);
    expect(sent).not.toContain(MARKER);
  });

  it('sans élément d’erreur, ne transmet rien', async () => {
    const { relay, forward } = setup();
    const body = envelope({ dsn: DSN }, [[{ type: 'session' }, { sid: '1' }]]);
    expect((await relay(post(body))).status).toBe(200);
    expect(forward).not.toHaveBeenCalled();
  });

  it.each([
    ['DSN étranger', 'http://cle-publique@evil.example:8000/3'],
    ['autre projet', 'http://cle-publique@glitchtip.interne:8000/4'],
    ['autre clé', 'http://autre-cle@glitchtip.interne:8000/3'],
  ])('403 : %s', async (_label, dsn) => {
    const { relay, forward } = setup();
    const response = await relay(post(envelope({ dsn }, [[{ type: 'event' }, errorEvent()]])));
    expect(response.status).toBe(403);
    expect(forward).not.toHaveBeenCalled();
  });

  it.each([
    ['corps non JSON', 'pas du json'],
    ['sans DSN', envelope({ event_id: 'a'.repeat(32) }, [[{ type: 'event' }, errorEvent()]])],
    ['élément illisible', envelope({ dsn: DSN }, [[{ type: 'event' }, '{tronqué']])],
    [
      'longueur hors du corps',
      `${JSON.stringify({ dsn: DSN })}\n{"type":"event","length":99999}\n{}`,
    ],
  ])('400 : %s', async (_label, body) => {
    const { relay, forward } = setup();
    expect((await relay(post(body))).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  it('413 au-delà de 200 000 octets', async () => {
    const { relay, forward } = setup();
    const event = { ...errorEvent(), extra: { pad: 'x'.repeat(MAX_BODY_BYTES) } };
    const response = await relay(post(envelope({ dsn: DSN }, [[{ type: 'event' }, event]])));
    expect(response.status).toBe(413);
    expect(forward).not.toHaveBeenCalled();
  });

  it('429 au-delà du débit permis pour une adresse', async () => {
    const { relay } = setup({ perClient: 2 });
    const body = envelope({ dsn: DSN }, [[{ type: 'session' }, {}]]);
    const from = { 'X-Forwarded-For': '198.51.100.1, 203.0.113.7' };
    expect((await relay(post(body, from))).status).toBe(200);
    expect((await relay(post(body, from))).status).toBe(200);
    expect((await relay(post(body, from))).status).toBe(429);
    // L'adresse retenue est la dernière (Caddy), pas celle que le client écrit en tête.
    const forged = { 'X-Forwarded-For': '192.0.2.99, 203.0.113.7' };
    expect((await relay(post(body, forged))).status).toBe(429);
    expect((await relay(post(body, { 'X-Forwarded-For': '203.0.113.8' }))).status).toBe(200);
  });

  it('502 si GlitchTip refuse ou ne répond pas', async () => {
    const { relay, forward } = setup();
    const body = envelope({ dsn: DSN }, [[{ type: 'event' }, errorEvent()]]);
    forward.mockResolvedValueOnce({ ok: false });
    expect((await relay(post(body))).status).toBe(502);
    forward.mockRejectedValueOnce(new Error('timeout'));
    expect((await relay(post(body))).status).toBe(502);
  });

  it('OBS-14 : sans DSN configuré, le relais n’existe pas', async () => {
    const forward = vi.fn<ForwardFn>();
    const relay = createRelay({
      dsn: parseDsn(undefined),
      limiter: new FixedWindowLimiter({ windowMs: 1, perClient: 1, total: 1, maxClients: 1 }),
      forward,
    });
    expect((await relay(post('{}'))).status).toBe(404);
  });

  it('405 pour toute autre méthode que POST', () => {
    expect(GET().status).toBe(405);
    expect(PUT().status).toBe(405);
    expect(GET().headers.get('Allow')).toBe('POST');
  });

  it('403 si la requête vient d’une autre origine', async () => {
    const { relay, forward } = setup();
    const body = envelope({ dsn: DSN }, [[{ type: 'event' }, errorEvent()]]);
    expect((await relay(post(body, { 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(403);
    expect(
      (await relay(post(body, { Origin: 'https://evil.example', Host: 'hotte.example' }))).status,
    ).toBe(403);
    expect((await relay(post(body, { 'Sec-Fetch-Site': 'same-origin' }))).status).toBe(200);
    expect(
      (await relay(post(body, { Origin: 'https://hotte.example', Host: 'hotte.example' }))).status,
    ).toBe(200);
    expect(forward).toHaveBeenCalledTimes(2);
  });

  it('400 pour plus d’une erreur par enveloppe', async () => {
    const { relay, forward } = setup();
    const body = envelope({ dsn: DSN }, [
      [{ type: 'event' }, errorEvent()],
      [{ type: 'event' }, errorEvent()],
    ]);
    expect((await relay(post(body))).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });
});

describe('adresse du client pour le débit', () => {
  it.each([
    ['198.51.100.1, 203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::9', '2001:db8:1:2::/64'],
    ['[2001:0db8:0001:0002::1]:443', '2001:db8:1:2::/64'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['[::FFFF:198.51.100.4]:443', '198.51.100.4'],
    ['64:ff9b:1:2::192.0.2.1', '64:ff9b:1:2::/64'],
    ['pas une adresse ::: ::', 'direct'],
  ])('%s → %s', (forwarded, expected) => {
    expect(clientAddress(new Headers({ 'X-Forwarded-For': forwarded }))).toBe(expected);
  });

  it('sans en-tête : direct', () => {
    expect(clientAddress(new Headers())).toBe('direct');
  });
});

describe('envoi réel vers GlitchTip', () => {
  async function withServer(
    handler: (url: string, headers: IncomingHttpHeaders) => { status: number; location?: string },
    run: (origin: string, seen: { url: string; headers: IncomingHttpHeaders }[]) => Promise<void>,
  ): Promise<void> {
    const seen: { url: string; headers: IncomingHttpHeaders }[] = [];
    const server = createServer((request, response) => {
      seen.push({ url: request.url ?? '', headers: request.headers });
      const { status, location } = handler(request.url ?? '', request.headers);
      response.writeHead(status, location ? { Location: location } : {});
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(`http://127.0.0.1:${port}`, seen);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  }

  it('corps seul, sans traceparent ni autre en-tête du navigateur', async () => {
    await withServer(
      () => ({ status: 200 }),
      async (origin, seen) => {
        const result = await createForward()(`${origin}/api/3/envelope/`, '{}');
        expect(result.ok).toBe(true);
        expect(seen).toHaveLength(1);
        expect(seen[0]?.headers['content-type']).toBe('application/x-sentry-envelope');
        expect(seen[0]?.headers.traceparent).toBeUndefined();
        expect(seen[0]?.headers.cookie).toBeUndefined();
      },
    );
  });

  it('ne suit pas une redirection', async () => {
    await withServer(
      (url) => (url === '/ailleurs' ? { status: 200 } : { status: 307, location: '/ailleurs' }),
      async (origin, seen) => {
        await expect(createForward()(`${origin}/api/3/envelope/`, '{}')).rejects.toThrow();
        expect(seen.map((request) => request.url)).toEqual(['/api/3/envelope/']);
      },
    );
  });
});
