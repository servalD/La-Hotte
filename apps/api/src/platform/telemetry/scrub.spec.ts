import { resolve } from 'node:path';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import type { ErrorEvent } from '@sentry/nestjs';
import {
  APP_ROOT,
  errorCode,
  isTrustedFrameLine,
  sanitizeError,
  scrubAttributes,
  scrubError,
  scrubErrorEvent,
  scrubSpan,
  scrubStack,
  stackFrames,
} from './scrub';

const MARKER = 'MARQUEUR-VELO-ROUGE';
/** Fichier de l'application : emplacement de confiance quel que soit le poste. */
const APP_FILE = resolve(__dirname, '..', '..', 'main.ts');
/** Dépendance installée dans le `node_modules` du dépôt pnpm. */
const REPO_DEPENDENCY = resolve(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'x.js');

describe('scrubAttributes (OBS-29)', () => {
  it.each([
    'url.full',
    'url.query',
    'url.path',
    'http.url',
    'http.target',
    'db.query.text',
    'db.statement',
    'exception.message',
    'exception.stacktrace',
    'client.address',
    'network.peer.address',
    'user_agent.original',
    'process.command_args',
    'process.executable.path',
    'host.name',
    'http.request.header.cookie',
    'http.response.header.set-cookie',
    'db.query.parameter.0',
  ])('retire %s', (key) => {
    expect(scrubAttributes({ [key]: MARKER })).toEqual({});
  });

  it('garde le gabarit de route, la méthode, le statut et le domaine', () => {
    const kept = {
      'http.route': '/api/v1/items/:id',
      'http.request.method': 'GET',
      'http.response.status_code': 500,
      'server.address': 'example.com',
      'db.system.name': 'postgresql',
    };
    expect(scrubAttributes(kept)).toEqual(kept);
  });
});

function fakeSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
  const context = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 };
  return {
    name: 'GET /api/v1/items/:id',
    kind: SpanKind.SERVER,
    spanContext: () => context,
    startTime: [1, 0],
    endTime: [2, 0],
    status: { code: SpanStatusCode.ERROR, message: MARKER },
    attributes: { 'url.full': `https://x/items?q=${MARKER}`, 'http.route': '/api/v1/items/:id' },
    links: [{ context, attributes: { 'url.query': MARKER } }],
    events: [
      { name: 'exception', time: [1, 5], attributes: { 'exception.message': MARKER } },
      { name: 'retry', time: [1, 6], attributes: { 'db.statement': MARKER, attempt: 2 } },
    ],
    duration: [1, 0],
    ended: true,
    resource: {} as ReadableSpan['resource'],
    instrumentationScope: { name: 'test' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ...overrides,
  };
}

describe('scrubSpan (OBS-22, OBS-29)', () => {
  it('ne laisse le marqueur nulle part', () => {
    const scrubbed = scrubSpan(fakeSpan());
    expect(JSON.stringify({ ...scrubbed, spanContext: scrubbed.spanContext() })).not.toContain(
      MARKER,
    );
  });

  it('retire les événements exception et le message de statut, garde le reste', () => {
    const scrubbed = scrubSpan(fakeSpan());
    expect(scrubbed.events.map((event) => event.name)).toEqual(['retry']);
    expect(scrubbed.events[0]?.attributes).toEqual({ attempt: 2 });
    expect(scrubbed.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(scrubbed.attributes).toEqual({ 'http.route': '/api/v1/items/:id' });
    expect(scrubbed.spanContext().traceId).toBe('a'.repeat(32));
  });

  // Constaté par le test OBS-26 le 2026-11-12 : l'en-tête `tracestate` du client ressortait.
  it('retire le traceState du span, du parent et des liens, garde les identifiants', () => {
    const traceState = {
      set: () => traceState,
      unset: () => traceState,
      get: () => MARKER,
      serialize: () => `client=${MARKER}`,
    };
    const context = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      traceFlags: 1,
      traceState,
      isRemote: true,
    };
    const scrubbed = scrubSpan(
      fakeSpan({
        spanContext: () => context,
        parentSpanContext: context,
        links: [{ context }],
      }),
    );
    const expected = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      traceFlags: 1,
      isRemote: true,
    };
    expect(scrubbed.spanContext()).toEqual(expected);
    expect(scrubbed.parentSpanContext).toEqual(expected);
    expect(scrubbed.links[0]?.context).toEqual(expected);
  });
});

describe('scrubStack et scrubError (OBS-25)', () => {
  it('retire le message de la pile, garde les cadres', () => {
    const error = new Error(`Valeur ${MARKER} invalide`);
    const stack = scrubStack(error);
    expect(stack).toMatch(/^\s+at /);
    expect(stack).not.toContain(MARKER);
  });

  // Constaté le 2026-11-12 avec PrismaClientInitializationError : les lignes du message qui
  // commencent par « at » étaient prises pour des cadres et envoyées à GlitchTip.
  it('retire un message multiligne dont des lignes ressemblent à des cadres', () => {
    const error = new Error(
      `Can't reach database server\n    at \`${MARKER}:5432\`\n    at ${MARKER} (/x/y.js:1:2)`,
    );
    const frames = stackFrames(error);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.join('\n')).not.toContain(MARKER);
  });

  // Revue de sécurité du 2026-11-12 : message modifié après la première lecture de la pile ;
  // la découpe par le message échoue et la ligne forgée doit tomber quand même.
  it('écarte une ligne forgée quand le message a changé après coup', () => {
    const error = new Error(`ligne 1
    at Reserve par ${MARKER} 120 EUR (/x:1:2)`);
    // Première lecture : V8 fige la pile avec le message d'alors.
    expect(error.stack).toContain('ligne 1');
    error.message = `Contexte : ${error.message}`;
    const frames = stackFrames(error);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.join('\n')).not.toContain(MARKER);
  });

  it.each([
    [`    at handler (${APP_FILE}:10:3)`, true],
    [`    at async Promise.all (index 0)`, false],
    [`    at new Promise (<anonymous>)`, true],
    [`    at Object.<anonymous> [as run] (${APP_FILE}:1:1)`, true],
    [`    at node:internal/process/task_queues:105:5`, true],
    [`    at x (${REPO_DEPENDENCY}:1:2)`, true],
    [`    at Foo.[Symbol.asyncIterator] (${APP_FILE}:1:2)`, true],
    [`    at ${MARKER} (/cadeaux/velo:12:3)`, false],
    [`    at Reserve par Alice (${APP_FILE}:1:2)`, false],
    [`Reserve par Alice at /cadeaux/velo:12:3`, false],
    // Contre-revue du 2026-11-12 : lignes forgées d'un seul mot.
    [`    at /node_modules/Reserve-par-Alice-120EUR:1:2`, false],
    [`    at node:Reserve-par-Alice:1:2`, false],
    [`    at Alice.offre.le.velo (/node_modules/x:1:2)`, false],
    [`    at file://evil/node_modules/Alice_velo:1:2`, false],
    [`    at x (/home/u/node_modules/pkg/index.js:1:2)`, false],
    [`    at x (${APP_FILE}/../../../../cadeaux:1:2)`, false],
  ])('isTrustedFrameLine(%j) = %s', (line, expected) => {
    expect(isTrustedFrameLine(line)).toBe(expected);
  });

  it('APP_ROOT est la racine de apps/api, jamais la racine du disque', () => {
    expect(APP_ROOT).toMatch(/\/apps\/api$/);
  });

  it('sanitizeError : copie sans message ni propriétés, causes comprises', () => {
    const cause = Object.assign(new RangeError(`cause ${MARKER}`), { meta: MARKER });
    const error = Object.assign(new TypeError(`échec ${MARKER}`, { cause }), {
      code: 'P2002',
      query: `SELECT ${MARKER}`,
    });
    const clean = sanitizeError(error);

    expect(clean.name).toBe('TypeError');
    expect(clean.message).toBe('');
    expect((clean as Error & { code?: string }).code).toBe('P2002');
    expect((clean.cause as Error).name).toBe('RangeError');
    const everything = JSON.stringify({
      own: Object.getOwnPropertyNames(clean).map((key) => String(clean[key as keyof Error])),
      stack: clean.stack,
      cause: (clean.cause as Error).stack,
      causeMessage: (clean.cause as Error).message,
    });
    expect(everything).not.toContain(MARKER);
    expect(clean.stack).toMatch(/^TypeError\n\s+at /);
  });

  it('sérialise type, code et cadres, jamais le message', () => {
    const error = Object.assign(new TypeError(MARKER), { code: 'P2002' });
    const serialized = scrubError(error);
    expect(serialized.type).toBe('TypeError');
    expect(serialized.code).toBe('P2002');
    expect(JSON.stringify(serialized)).not.toContain(MARKER);
  });

  it('refuse un code qui ressemble à du texte libre', () => {
    expect(errorCode({ code: MARKER.toLowerCase() })).toBeUndefined();
    expect(errorCode({ code: `Erreur sur ${MARKER}` })).toBeUndefined();
    expect(errorCode({ code: 'ECONNREFUSED' })).toBe('ECONNREFUSED');
  });
});

describe('scrubErrorEvent (OBS-20, OBS-21, OBS-28)', () => {
  const event: ErrorEvent = {
    type: undefined,
    event_id: 'e1',
    environment: 'preview',
    release: 'abc1234',
    message: MARKER,
    server_name: MARKER,
    transaction: `/api/v1/items/${MARKER}`,
    user: { id: MARKER, email: MARKER, ip_address: MARKER },
    request: {
      url: `https://app/items?q=${MARKER}`,
      query_string: MARKER,
      cookies: { session: MARKER },
      headers: { authorization: MARKER },
      data: { title: MARKER },
    },
    breadcrumbs: [{ message: MARKER, category: 'console' }],
    extra: { body: MARKER },
    modules: { [MARKER]: '1' },
    tags: { request_id: 'r-1', 'http.route': '/api/v1/items/:id', url: MARKER },
    contexts: {
      trace: { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), data: { q: MARKER } },
      runtime: { name: 'node', version: 'v22' },
      response: { status_code: 500, headers: { 'set-cookie': MARKER } },
    },
    exception: {
      values: [
        {
          type: 'Error',
          value: MARKER,
          mechanism: { type: 'generic', handled: true, data: { m: MARKER } },
          stacktrace: {
            frames: [
              {
                filename: APP_FILE,
                function: 'handler',
                lineno: 10,
                colno: 3,
                in_app: true,
                vars: { title: MARKER },
                context_line: MARKER,
                pre_context: [MARKER],
                post_context: [MARKER],
              },
              // Ligne de message analysée comme un cadre : pas de numéro de ligne.
              { filename: `\`${MARKER}:5432\``, abs_path: MARKER, module: MARKER },
              // Revue du 2026-11-12 : numéro de ligne valide, emplacement hors de l'application.
              { filename: `/cadeaux/${MARKER}`, module: MARKER, function: '?', lineno: 12 },
              // Emplacement de confiance, nom de fonction en texte libre.
              { filename: APP_FILE, function: `Reserve par ${MARKER}`, lineno: 3 },
            ],
          },
        },
      ],
    },
  };

  it('ne laisse le marqueur nulle part', () => {
    expect(JSON.stringify(scrubErrorEvent(event))).not.toContain(MARKER);
  });

  it('garde ce qui sert au regroupement et à la corrélation', () => {
    const scrubbed = scrubErrorEvent(event);
    expect(scrubbed.contexts?.trace).toEqual({ trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) });
    expect(scrubbed.tags).toEqual({ request_id: 'r-1', 'http.route': '/api/v1/items/:id' });
    expect(scrubbed.exception?.values?.[0]).toEqual({
      type: 'Error',
      mechanism: { type: 'generic', handled: true },
      stacktrace: {
        frames: [
          {
            filename: APP_FILE,
            function: 'handler',
            lineno: 10,
            colno: 3,
            in_app: true,
          },
        ],
      },
    });
    expect(scrubbed.release).toBe('abc1234');
  });
});
