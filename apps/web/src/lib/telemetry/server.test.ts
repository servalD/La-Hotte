// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/nextjs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sentry/nextjs')>()),
  init: sentry.init,
  captureException: sentry.captureException,
}));

const MARKER = 'MARQUEUR-VELO-MARIE';

/** Ce que le SDK reçoit, propriétés et causes comprises. */
function seenBySdk(): string {
  return JSON.stringify(
    sentry.captureException.mock.calls.map(([error, hint]) => {
      const parts: unknown[] = [hint];
      let current: unknown = error;
      while (current instanceof Error) {
        parts.push({
          own: Object.fromEntries(Object.entries(current)),
          message: current.message,
          stack: current.stack,
        });
        current = current.cause;
      }
      return parts;
    }),
  );
}

function errorWithMarker(): Error {
  return Object.assign(new Error(`titre ${MARKER}\n    at x (/cadeaux/${MARKER}:1:2)`), {
    meta: { query: MARKER },
    digest: MARKER,
    cause: new RangeError(MARKER),
  });
}

describe('signalement des erreurs du serveur Next (OBS-45, OBS-48)', () => {
  type Listener = (error: unknown) => void;
  type Event = 'uncaughtException' | 'unhandledRejection';
  let added: { event: Event; listener: Listener }[] = [];
  const listeners = (event: Event): Listener[] =>
    (process.listeners as (name: string) => Listener[])(event);
  const previousRuntime = process.env.NEXT_RUNTIME;

  beforeAll(async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const events = ['uncaughtException', 'unhandledRejection'] as const;
    const before = events.map(listeners);
    const { startServerTelemetry } = await import('./server');
    startServerTelemetry({ SENTRY_DSN: 'http://cle@127.0.0.1:1/1', DEPLOY_ENVIRONMENT: 'preview' });
    added = events.flatMap((event, index) =>
      listeners(event)
        .filter((listener) => !before[index]?.includes(listener))
        .map((listener) => ({ event, listener })),
    );
  });

  afterAll(() => {
    for (const { event, listener } of added) process.off(event, listener);
    process.env.NEXT_RUNTIME = previousRuntime;
  });

  it('onRequestError transmet une copie nettoyée et le gabarit de route, jamais le chemin', async () => {
    sentry.captureException.mockClear();
    const { onRequestError } = await import('../../instrumentation');
    await onRequestError(
      errorWithMarker(),
      { path: `/items/abc?url=${MARKER}`, method: 'GET', headers: { cookie: MARKER } },
      {
        routerKind: 'App Router',
        routePath: '/items/[id]',
        routeType: 'render',
        renderSource: 'react-server-components',
        revalidateReason: undefined,
      },
    );
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(seenBySdk()).not.toContain(MARKER);
    expect(sentry.captureException.mock.calls[0]?.[1]).toEqual({
      tags: { 'http.request.method': 'GET', 'http.route': '/items/[id]' },
    });
  });

  it('exceptions et rejets non gérés : copie nettoyée seulement', () => {
    sentry.captureException.mockClear();
    expect(added.map(({ event }) => event).sort()).toEqual([
      'uncaughtException',
      'unhandledRejection',
    ]);
    for (const { listener } of added) listener(errorWithMarker());
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
    expect(seenBySdk()).not.toContain(MARKER);
  });
});
